import User from "../models/user.js";
import { emitAppNotification } from "../services/notificationService.js";

export const getLeaderboard = async (_req, res) => {
  try {
    const users = await User.find()
      .select("username email level xp status photoUrl coins")
      .sort({ level: -1, xp: -1, username: 1 });

    return res.status(200).json(
      users.map((user) => ({
        id: user._id,
        username: user.username,
        email: user.email,
        level: user.level ?? 0,
        xp: user.xp ?? 0,
        coins: user.coins ?? 0,
        status: user.status ?? "offline",
        photoUrl: user.photoUrl,
      })),
    );
  } catch (error) {
    console.log("getLeaderboard error:", error.message);
    return res.status(500).json({ message: "Erreur lors du chargement du classement" });
  }
};

export const getAllUsers = async (_req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    return res.status(200).json(users);
  } catch (error) {
    console.log("getAllUsers error:", error.message);
    return res
      .status(500)
      .json({ message: "Erreur lors de la recuperation des utilisateurs" });
  }
};

export const getOneUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouve" });
    }
    return res.status(200).json(user);
  } catch (error) {
    console.log("getOneUser error:", error.message);
    return res
      .status(500)
      .json({ message: "Erreur lors de la recuperation de l'utilisateur" });
  }
};

//Juste pour les tests , afin d'eviter d'aller en bd a chaque fois
export const patchUserCoinsById = async (req, res) => {
  try {
    const { coins } = req.body;
    const parsedCoins = Number(coins);

    if (!Number.isFinite(parsedCoins)) {
      return res.status(400).json({ message: "Valeur de coins invalide" });
    }
    if (parsedCoins < 0) {
      return res
        .status(400)
        .json({ message: "Le nombre de pieces ne peut pas etre negatif" });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { coins: parsedCoins },
      { new: true, runValidators: true },
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ message: "Utilisateur non trouve" });
    }

    return res.status(200).json({
      message: "Nombre de pieces mis a jour",
      userId: updatedUser._id,
      coins: updatedUser.coins,
    });
  } catch (error) {
    console.log("patchUserCoinsById error:", error.message);
    return res
      .status(500)
      .json({ message: "Erreur lors de la mise a jour des pieces" });
  }
};

export const addCoinsToCurrentUser = async (req, res) => {
  try {
    const userId = req.user?._id;
    const amount = Number(req.body?.amount);

    if (!userId) {
      return res.status(401).json({ message: "Non authentifie" });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Montant de coins invalide" });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { coins: amount } },
      { new: true, runValidators: true },
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ message: "Utilisateur non trouve" });
    }

    return res.status(200).json({
      message: "Coins ajoutes",
      userId: updatedUser._id,
      coins: updatedUser.coins,
    });
  } catch (error) {
    console.log("addCoinsToCurrentUser error:", error.message);
    return res.status(500).json({ message: "Erreur lors de l'ajout des coins" });
  }
};

export const xpRequiredToLevelUp = (level) => {
  return 100 + level * 25;
};

export const addProgressRewardToCurrentUser = async (req, res) => {
  try {
    const userId = req.user?._id;
    const xpAmount = Math.max(0, Math.floor(Number(req.body?.xp ?? 0)));
    const coinAmount = Math.max(0, Math.floor(Number(req.body?.coins ?? 0)));
    const rewardType = (req.body?.rewardType ?? '').toString().trim();
    const rewardId = (req.body?.rewardId ?? '').toString().trim();

    if (!userId) {
      return res.status(401).json({ message: "Non authentifie" });
    }

    if (!rewardType || !rewardId) {
      return res.status(400).json({ message: "Identifiant de recompense invalide" });
    }

    if (!['chapter', 'quiz'].includes(rewardType)) {
      return res.status(400).json({ message: "Type de recompense invalide" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouve" });
    }

    const chapterRewards = new Set(user.completedChapterRewards ?? []);
    const quizRewards = new Set(user.completedQuizRewards ?? []);
    const claimedSet = rewardType === 'chapter' ? chapterRewards : quizRewards;

    if (claimedSet.has(rewardId)) {
      return res.status(200).json({
        message: "Recompense deja collecte",
        alreadyClaimed: true,
        userId: user._id,
        level: user.level ?? 0,
        xp: user.xp ?? 0,
        totalXP: user.totalXP ?? 0,
        coins: user.coins ?? 0,
        earned: { xp: 0, coins: 0 },
      });
    }

    let level = user.level ?? 0;
    let currentXp = user.xp ?? 0;

    user.totalXP = (user.totalXP ?? 0) + xpAmount;
    user.coins = (user.coins ?? 0) + coinAmount;
    currentXp += xpAmount;

    while (currentXp >= xpRequiredToLevelUp(level)) {
      currentXp -= xpRequiredToLevelUp(level);
      level += 1;
    }

    user.level = level;
    user.xp = currentXp;
    if (rewardType === 'chapter') {
      user.completedChapterRewards = [...chapterRewards, rewardId];
    } else {
      user.completedQuizRewards = [...quizRewards, rewardId];
    }
    await user.save();

    return res.status(200).json({
      message: "Recompense ajoutee",
      alreadyClaimed: false,
      userId: user._id,
      level: user.level,
      xp: user.xp,
      totalXP: user.totalXP,
      coins: user.coins,
      earned: {
        xp: xpAmount,
        coins: coinAmount,
      },
    });
  } catch (error) {
    console.log("addProgressRewardToCurrentUser error:", error.message);
    return res
      .status(500)
      .json({ message: "Erreur lors de l'ajout des recompenses" });
  }
};

export const updateUserRole = async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findByIdAndUpdate(userId, { role: "creator" });
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouve" });
    }
    return res.status(200).json({
      message: "Nouveau créateur de contenus",
      username: user.username,
      id: user._id,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur lors de la mise a jour du role" });
  }
};

export const sendFriendRequest = async (req, res) => {
  try {
    const senderId = req.user?._id?.toString();
    const targetId = req.params.targetUserId?.toString();

    if (!senderId || !targetId) {
      return res.status(400).json({ message: "Identifiants invalides" });
    }
    if (senderId === targetId) {
      return res.status(400).json({ message: "Impossible de s'ajouter soi-meme" });
    }

    const [sender, target] = await Promise.all([
      User.findById(senderId),
      User.findById(targetId),
    ]);

    if (!sender || !target) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    if (sender.friends.some((id) => id.toString() === targetId)) {
      return res.status(400).json({ message: "Deja amis" });
    }

    if (sender.friendRequestsSent.some((id) => id.toString() === targetId)) {
      return res.status(400).json({ message: "Demande deja envoyee" });
    }

    sender.friendRequestsSent.push(target._id);
    target.friendRequestsReceived.push(sender._id);

    await Promise.all([sender.save(), target.save()]);

    emitAppNotification(req.app.get("io"), target._id, {
      type: "friend_request",
      fromUserId: sender._id,
      fromUsername: sender.username,
      createdAt: new Date().toISOString(),
    });

    return res.status(200).json({ message: "Demande d'ami envoyee" });
  } catch (error) {
    return res.status(500).json({ message: "Erreur envoi demande d'ami" });
  }
};

export const getFriendRequests = async (req, res) => {
  try {
    const user = await User.findById(req.user?._id)
      .populate("friendRequestsReceived", "username email status photoUrl")
      .populate("friendRequestsSent", "username email status photoUrl")
      .populate("friends", "username email status photoUrl");

    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    return res.status(200).json({
      received: user.friendRequestsReceived.map((u) => ({
        id: u._id,
        username: u.username,
        email: u.email,
        status: u.status,
        photoUrl: u.photoUrl || null,
      })),
      sent: user.friendRequestsSent.map((u) => ({
        id: u._id,
        username: u.username,
        email: u.email,
        status: u.status,
        photoUrl: u.photoUrl || null,
      })),
      friends: user.friends.map((u) => ({
        id: u._id,
        username: u.username,
        email: u.email,
        status: u.status,
        photoUrl: u.photoUrl || null,
      })),
    });
  } catch (_error) {
    return res.status(500).json({ message: "Erreur chargement demandes d'amis" });
  }
};

export const respondFriendRequest = async (req, res) => {
  try {
    const currentUserId = req.user?._id?.toString();
    const requesterId = req.params.requesterId?.toString();
    const action = (req.body?.action || "").toString().toLowerCase();

    if (!currentUserId || !requesterId) {
      return res.status(400).json({ message: "Identifiants invalides" });
    }
    if (!["accept", "reject"].includes(action)) {
      return res.status(400).json({ message: "Action invalide" });
    }

    const [currentUser, requester] = await Promise.all([
      User.findById(currentUserId),
      User.findById(requesterId),
    ]);

    if (!currentUser || !requester) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    currentUser.friendRequestsReceived = currentUser.friendRequestsReceived.filter(
      (id) => id.toString() !== requesterId,
    );
    requester.friendRequestsSent = requester.friendRequestsSent.filter(
      (id) => id.toString() !== currentUserId,
    );

    if (action === "accept") {
      if (!currentUser.friends.some((id) => id.toString() === requesterId)) {
        currentUser.friends.push(requester._id);
      }
      if (!requester.friends.some((id) => id.toString() === currentUserId)) {
        requester.friends.push(currentUser._id);
      }
    }

    await Promise.all([currentUser.save(), requester.save()]);

    emitAppNotification(req.app.get("io"), requester._id, {
      type: "friend_request_response",
      toUserId: requester._id,
      fromUserId: currentUser._id,
      fromUsername: currentUser.username,
      action,
      createdAt: new Date().toISOString(),
    });

    return res.status(200).json({
      message: action === "accept" ? "Demande acceptee" : "Demande refusee",
    });
  } catch (_error) {
    return res.status(500).json({ message: "Erreur traitement demande d'ami" });
  }
};

export const blockUser = async (req, res) => {
  try {
    const currentUserId = req.user?._id?.toString();
    const targetId = req.params.targetUserId?.toString();
    if (!currentUserId || !targetId) {
      return res.status(400).json({ message: "Identifiants invalides" });
    }

    if (currentUserId === targetId) {
      return res.status(400).json({ message: "Action invalide" });
    }

    const user = await User.findById(currentUserId);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    if (!user.blockedUser.some((id) => id.toString() === targetId)) {
      user.blockedUser.push(targetId);
    }

    user.friendRequestsReceived = user.friendRequestsReceived.filter(
      (id) => id.toString() !== targetId,
    );
    user.friendRequestsSent = user.friendRequestsSent.filter(
      (id) => id.toString() !== targetId,
    );
    user.friends = user.friends.filter((id) => id.toString() !== targetId);

    await user.save();

    return res.status(200).json({ message: "Utilisateur bloque" });
  } catch (_error) {
    return res.status(500).json({ message: "Erreur blocage utilisateur" });
  }
};

export const getBlockedUsers = async (req, res) => {
  try {
    const user = await User.findById(req.user?._id).populate(
      "blockedUser",
      "username email status photoUrl",
    );

    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    return res.status(200).json(
      user.blockedUser.map((u) => ({
        id: u._id,
        username: u.username,
        email: u.email,
        status: u.status,
        photoUrl: u.photoUrl || null,
      })),
    );
  } catch (_error) {
    return res.status(500).json({ message: "Erreur chargement utilisateurs bloques" });
  }
};

export const unblockUser = async (req, res) => {
  try {
    const currentUserId = req.user?._id?.toString();
    const targetId = req.params.targetUserId?.toString();
    if (!currentUserId || !targetId) {
      return res.status(400).json({ message: "Identifiants invalides" });
    }

    const user = await User.findById(currentUserId);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    user.blockedUser = user.blockedUser.filter((id) => id.toString() !== targetId);
    await user.save();

    return res.status(200).json({ message: "Utilisateur debloque" });
  } catch (_error) {
    return res.status(500).json({ message: "Erreur deblocage utilisateur" });
  }
};
