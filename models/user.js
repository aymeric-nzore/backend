import mongoose from "mongoose";
import bcrypt from "bcrypt";
const userSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["user", "creator"],
      default: "user",
    },
    username: {
      type: String,
      required: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    level: {
      type: Number,
      default: 0,
    },
    xp: {
      type: Number,
      default: 0,
    },
    totalXP: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["online", "offline"],
      default: "offline",
    },
    friends: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    friendRequestsReceived: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    friendRequestsSent: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    blockedUser: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    photoUrl: {
      type: String,
      default: null,
    },
    ownedItems: [
      {
        itemId: mongoose.Schema.Types.ObjectId,
        itemName: String,
        type: {
          type: String,
          enum: ["song", "avatar", "animation"],
        },
      },
    ],
    avatar: {
      hair: String,
      eyes: String,
      outfit: String,
    },
    coins: {
      type: Number,
      default: 0,
      min: 0,
    },
    completedChapterRewards: {
      type: [String],
      default: [],
    },
    completedQuizRewards: {
      type: [String],
      default: [],
    },
    isPublicProfile: {
      type: Boolean,
      default: true,
    },
    fcmTokens: {
      type: [String],
      default: [],
    },
    ownedAnimations: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Animation",
      },
    ],
    activeSplashAnimation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Animation",
      default: null,
    },
    resetCode: String,
    resettCodeExpires: Date,
  },
  { timestamps: true },
);
userSchema.pre("save", async function () {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 12);
  }
});
userSchema.methods.correctPassword = async function (
  candidatePassword,
  userPassword,
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};
export default mongoose.model("User", userSchema);
