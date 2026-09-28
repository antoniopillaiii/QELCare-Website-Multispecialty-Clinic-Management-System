const router = require("express").Router();
const { authenticate, authorize } = require("../../../shared/middleware/tokenMiddleware");
const multer = require("multer");
const cloudinary = require("../../../config/cloudinary");
const User = require("../models/User");
const logger = require("../../../shared/utils/activityLogger");
const { logSafeError } = require("../../../shared/utils/safeErrorLog");

const { requireIdParam } = require("../../../shared/utils/requestValidation");

// Profile photos: one JPG, PNG or WEBP image of at most 5 MB. The declared
// type is checked while the upload streams in and the file's first bytes are
// checked after, so a renamed non-image never reaches Cloudinary or the user
// record. Problems are a 400 (413 when too large), never a 500.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const upload = multer({
 storage: multer.memoryStorage(),
 limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
 fileFilter: (_req, file, cb) => {
 if (PHOTO_TYPES.includes(file.mimetype)) return cb(null, true);
 const error = new Error("Only JPG, PNG, and WEBP images are allowed.");
 error.code = "INVALID_PHOTO_TYPE";
 return cb(error);
 },
});

function isImageContent(buffer) {
 if (!buffer || buffer.length < 12) return false;
 const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
 const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
 const webp = buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
 return jpeg || png || webp;
}

function receivePhoto(req, res, next) {
 upload.single("profilePicture")(req, res, (err) => {
 if (err instanceof multer.MulterError) {
 if (err.code === "LIMIT_FILE_SIZE") {
 return res.status(413).json({ success: false, message: "Profile image must be 5MB or smaller." });
 }
 return res.status(400).json({ success: false, message: "Upload a single image in the profilePicture field." });
 }
 if (err?.code === "INVALID_PHOTO_TYPE") return res.status(400).json({ success: false, message: err.message });
 if (err) return next(err);
 if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
 if (!isImageContent(req.file.buffer)) {
 return res.status(400).json({ success: false, message: "The file is not a valid JPG, PNG, or WEBP image." });
 }
 return next();
 });
}

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
 if (error || !result?.secure_url) {
 const uploadError = new Error(error?.message || "Image storage returned no URL");
 uploadError.photoStorage = true;
 reject(uploadError);
 } else resolve(result);
 }
 );
 stream.end(file.buffer);
 });
}

// Save the uploaded photo's URL; if that fails, remove the just-uploaded image
// so a failed save leaves nothing behind.
async function savePhoto(userId, result) {
 try {
 return await User.updateProfilePicture(userId, result.secure_url);
 } catch (err) {
 Promise.resolve()
 .then(() => cloudinary.uploader.destroy(result.public_id))
 .catch(() => {});
 throw err;
 }
}

function sendUploadError(res, context, err) {
 logSafeError(context, err);
 if (err.photoStorage) {
 return res.status(502).json({ success: false, message: "The photo couldn't be stored right now. Please try again." });
 }
 return res.status(500).json({ success: false, message: "Upload failed" });
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

router.post("/profile-picture", authenticate, receivePhoto, async (req, res) => {
 try {
 const result = await uploadProfileImage(req.file);
 const updated = await savePhoto(req.user.user_id, result);

 await logProfilePictureUpdate(req, req.user.user_id, false);

 res.json({ success: true, url: result.secure_url, data: updated });
 } catch (err) {
 sendUploadError(res, "Upload error", err);
 }
});

router.post(
 "/:userId/profile-picture",
 authenticate,
 authorize(["Admin"]),
 requireIdParam("userId", "user"),
 receivePhoto,
 async (req, res) => {
 try {
 // Check the account first so nothing is uploaded for a user that doesn't exist.
 if (!(await User.getUserById(req.params.userId))) {
 return res.status(404).json({ success: false, message: "User not found" });
 }
 const result = await uploadProfileImage(req.file);
 const updated = await savePhoto(req.params.userId, result);
 if (!updated) return res.status(404).json({ success: false, message: "User not found" });

 await logProfilePictureUpdate(req, req.params.userId, true);

 res.json({ success: true, url: result.secure_url, data: updated });
 } catch (err) {
 sendUploadError(res, "Admin upload error", err);
 }
 }
);

module.exports = router;
