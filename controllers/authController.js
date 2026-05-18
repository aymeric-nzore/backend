import User from "../models/user.js";
import { generateToken } from "../utils/generateToken.js";
import { OAuth2Client } from "google-auth-library";
import cloudinary from "../config/cloudinary.js";
import { generateOtpCode } from "../utils/generateOTPcode.js";
import { sendOTPEmail } from "../services/emailService.js";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const decodeJwtPayload = (token) => {
  try {
    const parts = (token || "").split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    return JSON.parse(json);
  } catch (_error) {
    return null;
  }
};

export const registerUser = async (req, res) => {
  const { username, email, password } = req.body;
  const normalizedUsername = username?.trim()?.toLowerCase();
  const normalizedEmail = email?.trim()?.toLowerCase();
  const normalizedPassword = password?.trim();

  if (!process.env.JWT_SECRET) {
    return res
      .status(500)
      .json({ message: "Configuration serveur manquante: JWT_SECRET" });
  }

  if (!normalizedUsername || !normalizedEmail || !normalizedPassword) {
    return res.status(400).json({ message: "Tous les champs sont requis" });
  }
  if (normalizedPassword.length < 6) {
    return res.status(400).json({ message: "Mot de passe trop faible" });
  }

  try {
    const user = await User.create({
      username: normalizedUsername,
      email: normalizedEmail,
      password: normalizedPassword,
    });

    return res.status(201).json({
      token: generateToken({ _id: user._id }),
      userId: user._id,
    });
  } catch (error) {
    console.log("registerUser error:", error.message);
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ message: "Nom d'utilisateur ou email deja utilise" });
    }
    if (error.name === "ValidationError") {
      const firstError = Object.values(error.errors || {})[0]?.message;
      return res
        .status(400)
        .json({ message: firstError || "Donnees invalides" });
    }
    if (error.message?.toLowerCase().includes("buffering timed out")) {
      return res.status(500).json({ message: "Base de donnees indisponible" });
    }
    return res
      .status(500)
      .json({ message: "Erreur lors de l'inscription", detail: error.message });
  }
};

export const loginUser = async (req, res) => {
  const { usernameOrEmail, password } = req.body;

  if (!usernameOrEmail || !password) {
    return res
      .status(400)
      .json({ message: "Identifiants et mot de passe requis" });
  }

  try {
    const identifier = usernameOrEmail.trim();
    const user = await User.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { username: identifier.toLowerCase() },
      ],
    });

    if (!user) {
      return res.status(401).json({ message: "Identifiants invalides" });
    }

    const isPasswordMatch = await user.correctPassword(password, user.password);
    if (!isPasswordMatch) {
      return res.status(401).json({ message: "Mot de passe invalide" });
    }

    return res.status(200).json({
      token: generateToken({ _id: user._id }),
      userId: user._id,
    });
  } catch (error) {
    console.log(error.message);
    return res.status(500).json({ message: "Erreur lors de la connexion" });
  }
};

export const googleAuthCallback = async (req, res) => {
  if (!req.user?._id) {
    return res.status(401).json({ message: "Google authentication failed" });
  }

  const token = generateToken(req.user);
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const isMobileCallback = state.startsWith("ivox://");

  if (isMobileCallback) {
    const redirectUrl = `${state}${state.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}&userId=${encodeURIComponent(String(req.user._id))}`;
    return res.redirect(redirectUrl);
  }

  return res.status(200).json({
    token,
    userId: req.user._id,
  });
};

export const loginGoogleMobile = async (req, res) => {
  try {
    const { idToken, accessToken } = req.body || {};
    if (!idToken && !accessToken) {
      return res.status(400).json({ message: "idToken ou accessToken requis" });
    }

    let email = null;
    let googleId = null;
    let displayName = null;

    if (idToken) {
      const audiences = [
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_ANDROID_CLIENT_ID,
        process.env.GOOGLE_WEB_CLIENT_ID,
      ].filter(Boolean);

      if (audiences.length === 0) {
        return res.status(500).json({
          message: "Configuration Google manquante",
          detail:
            "Set GOOGLE_CLIENT_ID or GOOGLE_ANDROID_CLIENT_ID or GOOGLE_WEB_CLIENT_ID",
        });
      }

      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: audiences.length === 1 ? audiences[0] : audiences,
      });

      const payload = ticket.getPayload();
      email = payload?.email?.toLowerCase() || null;
      googleId = payload?.sub || null;
      displayName = payload?.name || null;
    } else if (accessToken) {
      const googleResponse = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!googleResponse.ok) {
        const detail = await googleResponse.text();
        return res.status(401).json({
          message: "Connexion Google echouee",
          detail,
        });
      }

      const payload = await googleResponse.json();
      email = payload?.email?.toLowerCase() || null;
      googleId = payload?.sub || null;
      displayName = payload?.name || null;
    }

    if (!email || !googleId) {
      return res.status(401).json({ message: "Compte Google invalide" });
    }

    let user = await User.findOne({
      $or: [{ googleId }, { email }],
    });

    if (!user) {
      const baseUsername = (
        displayName ||
        email.split("@")[0] ||
        "user"
      ).toLowerCase();
      let username = baseUsername;
      let suffix = 1;

      while (await User.exists({ username })) {
        username = `${baseUsername}${suffix}`;
        suffix += 1;
      }

      user = await User.create({
        googleId,
        email,
        username,
        password: `google_${googleId}_${Date.now()}`,
      });
    } else if (!user.googleId) {
      user.googleId = googleId;
      await user.save();
    }

    return res.status(200).json({
      token: generateToken({ _id: user._id }),
      userId: user._id,
    });
  } catch (error) {
    const tokenPayload = decodeJwtPayload(req.body?.idToken);
    const receivedAudience = tokenPayload?.aud || null;

    return res.status(401).json({
      message: "Connexion Google echouee",
      detail: error?.message || "invalid_google_token",
      receivedAudience,
      expectedAudience: [
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_ANDROID_CLIENT_ID,
        process.env.GOOGLE_WEB_CLIENT_ID,
      ].filter(Boolean),
    });
  }
};

export const getMe = async (req, res) => {
  if (!req.user?._id) {
    return res.status(401).json({ message: "Non authentifie" });
  }

  const ownedItems = (req.user.ownedItems || []).map((item) => ({
    itemId: String(item.itemId),
    itemName: item.itemName,
    type: item.type,
  }));

  return res.status(200).json({
    id: req.user._id,
    username: req.user.username,
    email: req.user.email,
    status: req.user.status,
    lastSeen: req.user.lastSeen,
    photoUrl: req.user.photoUrl || null,
    isPublicProfile: req.user.isPublicProfile ?? true,
    level: req.user.level ?? 0,
    xp: req.user.xp ?? 0,
    coins: req.user.coins ?? 0,
    ownedItems,
  });
};

export const updateProfilePrivacy = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { isPublicProfile } = req.body || {};

    if (!userId) {
      return res.status(401).json({ message: "Non authentifie" });
    }

    if (typeof isPublicProfile !== "boolean") {
      return res
        .status(400)
        .json({ message: "isPublicProfile doit etre un booleen" });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { isPublicProfile },
      { new: true },
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "Utilisateur non trouve" });
    }

    return res.status(200).json({
      message: "Visibilite du profil mise a jour",
      isPublicProfile: updatedUser.isPublicProfile,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Erreur mise a jour visibilite profil",
      detail: error?.message,
    });
  }
};

export const updateUsername = async (req, res) => {
  try {
    const userId = req.user?._id;
    const rawUsername = (req.body?.username || "").toString();
    const username = rawUsername.trim().toLowerCase();

    if (!userId) {
      return res.status(401).json({ message: "Non authentifie" });
    }

    if (!username) {
      return res.status(400).json({ message: "Nom d'utilisateur requis" });
    }

    if (username.length < 3) {
      return res
        .status(400)
        .json({
          message: "Le nom d'utilisateur doit contenir au moins 3 caracteres",
        });
    }

    const conflict = await User.findOne({
      username,
      _id: { $ne: userId },
    });

    if (conflict) {
      return res
        .status(400)
        .json({ message: "Nom d'utilisateur deja utilise" });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { username },
      { new: true },
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "Utilisateur non trouve" });
    }

    return res.status(200).json({
      message: "Nom d'utilisateur mis a jour",
      username: updatedUser.username,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Erreur mise a jour du nom d'utilisateur",
      detail: error?.message,
    });
  }
};

export const uploadProfileImage = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ message: "Non authentifie" });
    }

    if (!req.file?.buffer) {
      return res.status(400).json({ message: "Image manquante" });
    }

    const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    const uploaded = await cloudinary.uploader.upload(dataUri, {
      folder: "ivox/profile",
      public_id: `user_${userId}_${Date.now()}`,
      overwrite: true,
      resource_type: "image",
    });

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { photoUrl: uploaded.secure_url },
      { new: true },
    );

    return res.status(200).json({
      message: "Photo de profil mise a jour",
      photoUrl: updatedUser?.photoUrl || uploaded.secure_url,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Erreur upload image profil",
      detail: error?.message,
    });
  }
};

export const registerFcmToken = async (req, res) => {
  try {
    const userId = req.user?._id;
    const token = (req.body?.fcmToken || "").toString().trim();

    if (!userId) {
      return res.status(401).json({ message: "Non authentifie" });
    }

    if (!token) {
      return res.status(400).json({ message: "fcmToken requis" });
    }

    await User.findByIdAndUpdate(userId, {
      $addToSet: { fcmTokens: token },
    });

    return res.status(200).json({ message: "FCM token enregistre" });
  } catch (error) {
    return res.status(500).json({
      message: "Erreur enregistrement FCM token",
      detail: error?.message,
    });
  }
};

export const unregisterFcmToken = async (req, res) => {
  try {
    const userId = req.user?._id;
    const token = (req.body?.fcmToken || "").toString().trim();

    if (!userId) {
      return res.status(401).json({ message: "Non authentifie" });
    }

    if (!token) {
      return res.status(400).json({ message: "fcmToken requis" });
    }

    await User.findByIdAndUpdate(userId, {
      $pull: { fcmTokens: token },
    });

    return res.status(200).json({ message: "FCM token supprime" });
  } catch (error) {
    return res.status(500).json({
      message: "Erreur suppression FCM token",
      detail: error?.message,
    });
  }
};

export const logoutUser = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, {
      status: "offline",
      lastSeen: new Date(),
    });

    return res.status(200).json({
      message: "Déconnexion reussie",
    });
  } catch (error) {
    console.log("logoutUser error:", error.message);
    return res.status(500).json({ message: "Erreur lors de la déconnexion" });
  }
};

export const deleteAccount = async (req, res) => {
  try {
    const targetUserId = req.params.id || req.user?.id;
    if (!targetUserId) {
      return res
        .status(400)
        .json({ message: "Identifiant utilisateur manquant" });
    }

    const user = await User.findByIdAndDelete(targetUserId);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouve" });
    }

    return res.status(200).json({
      message: "Compte Supprime",
      userId: user._id,
    });
  } catch (e) {
    console.log(e);
    return res.status(500).json({ message: "Erreur serveur" });
  }
};
export const forgotPassword = async (req, res) => {
  try {
    const email = (req.body?.email || "").toString().trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ message: "Email requis" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    const code = generateOtpCode();
    user.resetCode = code;
    user.resettCodeExpires = Date.now() + 1000 * 60; // 60 secondes
    await user.save();

    try {
      await sendOTPEmail(email, code);
    } catch (emailError) {
      console.error("Email send failed:", emailError.message);
      return res.status(500).json({
        message: "Erreur envoi email",
        detail: emailError.message,
      });
    }

    return res.status(200).json({ message: "OTP envoye a l'email" });
  } catch (error) {
    console.error("forgotPassword error:", error.message);
    return res.status(500).json({
      message: "Erreur lors du traitement forgotPassword",
      detail: error.message,
    });
  }
};
export const resetPassword = async (req, res) => {
  try {
    const email = (req.body?.email || "").toString().trim().toLowerCase();
    const code = (req.body?.code || "").toString().trim();
    const newPassword = (req.body?.newPassword || "").toString().trim();

    if (!email || !code || !newPassword) {
      return res
        .status(400)
        .json({ message: "Email, code et nouveau mot de passe requis" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Mot de passe trop faible" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    if (!user.resettCodeExpires || user.resettCodeExpires < Date.now()) {
      return res.status(400).json({ message: "Code OTP expire" });
    }

    if (user.resetCode !== code) {
      return res.status(400).json({ message: "Code invalide" });
    }

    user.password = newPassword;
    user.resetCode = undefined;
    user.resettCodeExpires = undefined;

    await user.save();
    return res.status(200).json({ message: "Mot de passe reinitialise" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
