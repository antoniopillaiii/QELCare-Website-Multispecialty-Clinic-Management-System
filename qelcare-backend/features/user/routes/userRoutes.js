const router = require("express").Router();
const { authenticate, authorize } = require("../../../shared/middleware/tokenMiddleware");
const multer = require("multer");
const cloudinary = require("../../../config/cloudinary");
const User = require("../models/User");
const logger = require("../../../shared/utils/activityLogger");

const upload = multer({
 storage: multer.memoryStorage(),
 limits: { fileSize: 5 * 1024 * 1024 },
});

const {
 getProfile,
 updateProfile,
 getAllUsers,
 getDoctors,
 createUser,
 updateUserStatus,
 updateUserRole,
 updateUserDetails,
 getRoles,
} = require("../controllers/userController");

async function uploadProfileImage(file) {
 return new Promise((resolve, reject) => {
 const stream = cloudinary.uploader.upload_stream(
 { folder: "qelcare-profiles", resource_type: "image" },
 (error, result) => {
 if (error) reject(error);
 else resolve(result);
 }
 );
 stream.end(file.buffer);
 });
}

async function logProfilePictureUpdate(req, targetUserId, isAdminUpdate) {
 await logger.log({
 userId: req.user?.user_id || null,
 action: isAdminUpdate ? "USER_PROFILE_PHOTO_UPDATED" : "PROFILE_PHOTO_UPDATED",
 entityType: "user",
 entityId: Number(targetUserId),
 description: isAdminUpdate
 ? `Admin updated profile photo for user #${targetUserId}.`
 : "User updated their profile photo.",
 ip: logger.getIP(req),
 metadata: {
 target_user_id: Number(targetUserId),
 updated_by_admin: Boolean(isAdminUpdate),
 },
 });
}

// Patient self-registration lives only at /auth/patient/register (email OTP
// verification + privacy consent + rate limiting). The old public
// POST /users/register created already-verified accounts without any of that
// and was unused, so it has been removed.

router.get("/me", authenticate, getProfile);
router.put("/me", authenticate, updateProfile);

router.get(
 "/doctors",
 authenticate,
 authorize(["Admin", "Doctor", "Nurse", "Cashier", "Patient", "Frontdesk"]),
 getDoctors
);
router.get("/", authenticate, authorize(["Admin"]), getAllUsers);
router.post("/", authenticate, authorize(["Admin"]), createUser);
router.get("/roles", authenticate, authorize(["Admin"]), getRoles);
router.patch("/:userId/status", authenticate, authorize(["Admin"]), updateUserStatus);
router.patch("/:userId/role", authenticate, authorize(["Admin"]), updateUserRole);
router.patch("/:userId/details", authenticate, authorize(["Admin"]), updateUserDetails);

router.post("/profile-picture", authenticate, upload.single("profilePicture"), async (req, res) => {
 try {
 if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

 const result = await uploadProfileImage(req.file);
 const updated = await User.updateProfilePicture(req.user.user_id, result.secure_url);

 await logProfilePictureUpdate(req, req.user.user_id, false);

 res.json({ success: true, url: result.secure_url, data: updated });
 } catch (err) {
 console.error("Upload error:", err);
 res.status(500).json({ success: false, message: "Upload failed" });
 }
});

router.post(
 "/:userId/profile-picture",
 authenticate,
 authorize(["Admin"]),
 upload.single("profilePicture"),
 async (req, res) => {
 try {
 if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

 const result = await uploadProfileImage(req.file);
 const updated = await User.updateProfilePicture(req.params.userId, result.secure_url);
 if (!updated) return res.status(404).json({ success: false, message: "User not found" });

 await logProfilePictureUpdate(req, req.params.userId, true);

 res.json({ success: true, url: result.secure_url, data: updated });
 } catch (err) {
 console.error("Admin upload error:", err);
 res.status(500).json({ success: false, message: "Upload failed" });
 }
 }
);

module.exports = router;
