import express from "express";
import {
  blockUser,
  getFriendRequests,
  getAllUsers,
  getBlockedUsers,
  getLeaderboard,
  getOneUser,
  addCoinsToCurrentUser,
  patchUserCoinsById,
  respondFriendRequest,
  sendFriendRequest,
  unblockUser,
  updateUserRole,
} from "../controllers/userController.js";
import { deleteAccount } from "../controllers/authController.js";
import adminMiddleware from "../middlewares/adminMiddleware.js";
import authMiddleware from "../middlewares/authMiddleware.js";

const router = express.Router();

//PATCH
router.post("/me/coins/reward", authMiddleware, addCoinsToCurrentUser);
router.patch("/:id/coins", adminMiddleware, patchUserCoinsById);
router.patch("/:id/updateRole", adminMiddleware, updateUserRole);
//GET
router.get("/leaderboard", authMiddleware, getLeaderboard);
router.get("/friends/requests", authMiddleware, getFriendRequests);
router.get("/blocked", authMiddleware, getBlockedUsers);
router.get("/", adminMiddleware, getAllUsers);
router.get("/:id", adminMiddleware, getOneUser);

//POST
router.post("/friends/request/:targetUserId", authMiddleware, sendFriendRequest);
router.post(
  "/friends/request/:requesterId/respond",
  authMiddleware,
  respondFriendRequest,
);
router.post("/block/:targetUserId", authMiddleware, blockUser);
router.post("/unblock/:targetUserId", authMiddleware, unblockUser);

//DELETE
router.delete("/:id", adminMiddleware, deleteAccount);

export default router;
