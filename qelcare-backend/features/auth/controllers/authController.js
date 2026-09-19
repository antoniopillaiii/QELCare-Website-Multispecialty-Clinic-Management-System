const pool = require("../../../config/database");
const bcrypt = require("bcrypt");
const tokenManager = require("../../../shared/utils/tokenManager");
const authService = require("../services/authService");
const logger = require("../../../shared/utils/activityLogger");
const passwordHistory = require("../../../shared/utils/passwordHistory");
const {
  validateLoginInput,
  validateEmail,
  validatePasswordChange,
  validateResetPassword,
  validateOTPCode,
} = require("../validators/authValidator");

const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    const errors = validateLoginInput(username, password);
    if (errors.length > 0) return res.status(400).json({ success: false, errors });

    const result = await pool.query(
      `SELECT u.user_id, u.username, u.password, u.email,
              u.first_name, u.last_name, u.profile_picture,
              u.status, u.lockout_until, u.failed_login_attempts,
              r.role_name
       FROM users u
       JOIN roles r ON u.role_id = r.role_id
       WHERE LOWER(u.username) = LOWER($1)`,
      [String(username).trim()]
    );

    if (result.rows.length === 0) {
      // Generic message (matches the wrong-password response) to avoid username enumeration.
      return res.status(401).json({ success: false, message: "Invalid username or password" });
    }

    const user = result.rows[0];
    const now = new Date();

    if (user.status === "deactivated") {
      return res.status(403).json({ success: false, message: "Account has been deactivated" });
    }

    if (user.status === "unverified") {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_UNVERIFIED",
        message: "Account is not yet verified. Please verify your email before signing in.",
        email: user.email,
      });
    }

    if (user.status === "locked" && user.lockout_until) {
      if (now < new Date(user.lockout_until)) {
        const diffMs = new Date(user.lockout_until) - now;
        const minutes = Math.floor(diffMs / 60000);
        const seconds = Math.floor((diffMs % 60000) / 1000);
        return res.status(403).json({
          success: false,
          message: `Account locked. Try again in ${minutes}m ${seconds}s`,
          lockout_until: user.lockout_until,
        });
      }

      await pool.query(
        `UPDATE users
         SET status = 'verified',
             lockout_until = NULL,
             failed_login_attempts = 0,
             updated_at = NOW()
         WHERE user_id = $1`,
        [user.user_id]
      );
      user.status = "verified";
    }

    if (user.status === "locked" && !user.lockout_until) {
      return res.status(403).json({
        success: false,
        message: "Account is permanently locked. Please contact an administrator.",
      });
    }

    const validPassword = await bcrypt.compare(String(password), user.password);

    if (!validPassword) {
      const attempts = Number(user.failed_login_attempts || 0) + 1;
      let lockMinutes = 0;

      if (attempts >= 8) lockMinutes = null;
      else if (attempts === 5) lockMinutes = 15;
      else if (attempts === 3) lockMinutes = 5;

      if (attempts >= 8) {
        await pool.query(
          `UPDATE users
           SET failed_login_attempts = $1,
               status = 'locked',
               lockout_until = NULL,
               updated_at = NOW()
           WHERE user_id = $2`,
          [attempts, user.user_id]
        );
        await logger.log({
          userId: user.user_id,
          action: "ACCOUNT_LOCKED",
          entityType: "user",
          entityId: user.user_id,
          description: `Account ${user.username} was permanently locked after repeated failed login attempts.`,
          ip: logger.getIP(req),
          metadata: { attempts },
        });
        return res.status(403).json({
          success: false,
          message: "Account permanently locked. Contact an administrator.",
        });
      }

      if (lockMinutes > 0) {
        const lockUntil = new Date(Date.now() + lockMinutes * 60000);
        await pool.query(
          `UPDATE users
           SET failed_login_attempts = $1,
               status = 'locked',
               lockout_until = $2,
               updated_at = NOW()
           WHERE user_id = $3`,
          [attempts, lockUntil, user.user_id]
        );
        await logger.log({
          userId: user.user_id,
          action: "ACCOUNT_TEMP_LOCKED",
          entityType: "user",
          entityId: user.user_id,
          description: `Account ${user.username} was temporarily locked for ${lockMinutes} minutes.`,
          ip: logger.getIP(req),
          metadata: { attempts, lock_minutes: lockMinutes, lockout_until: lockUntil },
        });
        return res.status(403).json({
          success: false,
          message: `Account locked for ${lockMinutes} minutes`,
          lockout_until: lockUntil,
          attempts,
        });
      }

      await pool.query(
        `UPDATE users
         SET failed_login_attempts = $1,
             updated_at = NOW()
         WHERE user_id = $2`,
        [attempts, user.user_id]
      );

      const attemptsLeft = attempts < 5 ? 5 - attempts : null;
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
        ...(attemptsLeft !== null && { attempts_left: attemptsLeft }),
      });
    }

    await pool.query(
      `UPDATE users
       SET failed_login_attempts = 0,
           status = 'verified',
           lockout_until = NULL,
           last_login = NOW(),
           updated_at = NOW()
       WHERE user_id = $1`,
      [user.user_id]
    );

    const token = await tokenManager.createToken({
      user_id: user.user_id,
      username: user.username,
      email: user.email,
      role: user.role_name,
    });

    await logger.log({
      userId: user.user_id,
      action: "LOGIN",
      entityType: "auth",
      entityId: user.user_id,
      description: `${user.username} logged in.`,
      ip: logger.getIP(req),
      metadata: { role: user.role_name },
    });

    return res.status(200).json({
      success: true,
      token,
      user: {
        user_id: user.user_id,
        username: user.username,
        role: user.role_name,
        first_name: user.first_name,
        last_name: user.last_name,
        profile_picture: user.profile_picture || null,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Login failed" });
  }
};

const logout = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(400).json({ success: false, message: "No token provided" });

    await tokenManager.revokeToken(token);
    await logger.log({
      userId: req.user?.user_id || null,
      action: "LOGOUT",
      entityType: "auth",
      entityId: req.user?.user_id || null,
      description: `${req.user?.username || "User"} logged out.`,
      ip: logger.getIP(req),
    });

    res.status(200).json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ success: false, message: "Logout failed" });
  }
};

const logoutAll = async (req, res) => {
  try {
    await tokenManager.revokeAllUserTokens(req.user.user_id);
    await logger.log({
      userId: req.user.user_id,
      action: "LOGOUT_ALL",
      entityType: "auth",
      entityId: req.user.user_id,
      description: `${req.user.username || "User"} logged out from all devices.`,
      ip: logger.getIP(req),
    });
    res.status(200).json({ success: true, message: "Logged out from all devices" });
  } catch (error) {
    console.error("Logout all error:", error);
    res.status(500).json({ success: false, message: "Logout all failed" });
  }
};

const sendOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const channel = String(req.body.channel || "email").toLowerCase();
    const errors = validateEmail(email);
    if (errors.length > 0) return res.status(400).json({ success: false, errors });

    const result = await authService.sendOTP(email, {
      channel,
      purpose: authService.PURPOSES.PASSWORD_RESET,
      subject: "QELCare - Password Reset Verification Code",
    });
    res.status(result.status || (result.success ? 200 : 400)).json({
      success: result.success,
      code: result.code,
      channel: result.channel,
      retry_after: result.retry_after,
      dev_fallback: Boolean(result.dev),
      message: result.message,
    });
  } catch (error) {
    console.error("Send OTP error:", error);
    res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
};

const verifyOTP = async (req, res) => {
  try {
    const { email, code } = req.body;
    const emailErrors = validateEmail(email);
    if (emailErrors.length > 0) return res.status(400).json({ success: false, errors: emailErrors });

    const codeErrors = validateOTPCode(code);
    if (codeErrors.length > 0) return res.status(400).json({ success: false, errors: codeErrors });

    const result = await authService.verifyOTP(email, code, {
      purpose: authService.PURPOSES.PASSWORD_RESET,
      consume: false,
    });
    res.status(result.status || (result.success ? 200 : 400)).json({
      success: result.success,
      code: result.code,
      message: result.message,
      attempts_left: result.attempts_left,
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({ success: false, message: "OTP verification failed" });
  }
};

const resendOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const channel = String(req.body.channel || "email").toLowerCase();
    const errors = validateEmail(email);
    if (errors.length > 0) return res.status(400).json({ success: false, errors });

    const result = await authService.resendOTP(email, {
      channel,
      purpose: authService.PURPOSES.PASSWORD_RESET,
      subject: "QELCare - Password Reset Verification Code",
    });
    res.status(result.status || (result.success ? 200 : 400)).json({
      success: result.success,
      code: result.code,
      channel: result.channel,
      retry_after: result.retry_after,
      dev_fallback: Boolean(result.dev),
      message: result.message,
    });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(500).json({ success: false, message: "Failed to resend OTP" });
  }
};

const resetPassword = async (req, res) => {
  const client = await pool.connect();
  try {
    let { email, code, newPassword } = req.body;
    email = authService.normalizeEmail(email);
    code = String(code || "").trim();
    newPassword = String(newPassword || "");

    const errors = validateResetPassword(email, newPassword, code);
    if (errors.length > 0) return res.status(400).json({ success: false, errors, message: errors[0] });

    await client.query("BEGIN");

    const userResult = await client.query(
      "SELECT user_id, username, password, status FROM users WHERE LOWER(email) = LOWER($1) FOR UPDATE",
      [email]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = userResult.rows[0];

    if (user.status === "deactivated") {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, message: "Account is deactivated" });
    }

    if (user.status === "unverified") {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, message: "Verify your email before resetting your password" });
    }

    if (await passwordHistory.isPasswordReused(client, user.user_id, newPassword, user.password)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: passwordHistory.REUSE_MESSAGE });
    }

    const otp = await authService.verifyOTP(email, code, {
      client,
      purpose: authService.PURPOSES.PASSWORD_RESET,
      consume: true,
    });

    if (!otp.success) {
      await client.query("COMMIT");
      return res.status(otp.status || 400).json({ success: false, code: otp.code, message: otp.message, attempts_left: otp.attempts_left });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await client.query(
      `UPDATE users
       SET password = $1,
           failed_login_attempts = 0,
           status = CASE WHEN status = 'locked' THEN 'verified' ELSE status END,
           lockout_until = NULL,
           password_changed_at = NOW(),
           updated_at = NOW()
       WHERE user_id = $2`,
      [hashedPassword, user.user_id]
    );

    // Remember the retired password so it can't be reused on a future reset/change.
    await passwordHistory.recordRetiredPassword(client, user.user_id, user.password);

    await client.query("DELETE FROM active_tokens WHERE user_id = $1", [user.user_id]);
    await client.query("COMMIT");

    await logger.log({
      userId: user.user_id,
      action: "PASSWORD_RESET",
      entityType: "auth",
      entityId: user.user_id,
      description: `${user.username || email} reset their password.`,
      ip: logger.getIP(req),
    });

    res.status(200).json({ success: true, message: "Password reset successfully. Please login again." });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    console.error("Reset password error:", error);
    res.status(500).json({ success: false, message: "Password reset failed" });
  } finally {
    client.release();
  }
};

// After a SUCCESSFUL password change, block another change for this window. Failed
// attempts (wrong current password, weak/reused new password) do NOT start the
// cooldown — only a real change bumps users.password_changed_at. This throttles rapid
// password churn/abuse on top of the IP rate-limit already applied to /auth/password.
const PASSWORD_CHANGE_COOLDOWN_SECONDS = 120;

const changePassword = async (req, res) => {
  const client = await pool.connect();
  try {
    let { currentPassword, newPassword } = req.body;
    currentPassword = String(currentPassword || "");
    newPassword = String(newPassword || "");

    const errors = validatePasswordChange(currentPassword, newPassword);
    if (errors.length > 0) return res.status(400).json({ success: false, errors, message: errors[0] });

    await client.query("BEGIN");

    const result = await client.query(
      "SELECT user_id, username, password, password_changed_at FROM users WHERE user_id = $1 FOR UPDATE",
      [req.user.user_id]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = result.rows[0];

    // Strictly verify the CURRENT password against the active DB hash BEFORE any
    // update. On mismatch we roll back (nothing is written) and return 400 — NOT 401.
    // A 401 here would be read by the client's authFetch as an expired session and
    // would wrongly clear the token and redirect the user to the login page.
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        code: "INCORRECT_CURRENT_PASSWORD",
        message: "Incorrect current password",
      });
    }

    // Cooldown: refuse a second change too soon after the last successful one.
    if (user.password_changed_at) {
      const elapsedMs = Date.now() - new Date(user.password_changed_at).getTime();
      const remainingSec = Math.ceil((PASSWORD_CHANGE_COOLDOWN_SECONDS * 1000 - elapsedMs) / 1000);
      if (remainingSec > 0) {
        await client.query("ROLLBACK");
        return res.status(429).json({
          success: false,
          code: "PASSWORD_CHANGE_COOLDOWN",
          retry_after: remainingSec,
          message: `You changed your password recently. Please wait ${remainingSec}s before changing it again.`,
        });
      }
    }

    if (await passwordHistory.isPasswordReused(client, req.user.user_id, newPassword, user.password)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: passwordHistory.REUSE_MESSAGE });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await client.query(
      `UPDATE users
       SET password = $1,
           password_changed_at = NOW(),
           updated_at = NOW()
       WHERE user_id = $2`,
      [hashed, req.user.user_id]
    );

    // Remember the retired password so it can't be reused on a future reset/change.
    await passwordHistory.recordRetiredPassword(client, req.user.user_id, user.password);

    await client.query("DELETE FROM active_tokens WHERE user_id = $1", [req.user.user_id]);
    await client.query("COMMIT");

    await logger.log({
      userId: req.user.user_id,
      action: "PASSWORD_CHANGED",
      entityType: "auth",
      entityId: req.user.user_id,
      description: `${user.username || req.user.username || "User"} changed their password.`,
      ip: logger.getIP(req),
    });

    res.status(200).json({ success: true, message: "Password changed. Please login again." });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    console.error("Change password error:", error);
    res.status(500).json({ success: false, message: "Password change failed" });
  } finally {
    client.release();
  }
};

const validateToken = async (req, res) => {
  res.status(200).json({ success: true, user: req.user });
};

module.exports = {
  login,
  logout,
  logoutAll,
  sendOTP,
  verifyOTP,
  resendOTP,
  resetPassword,
  changePassword,
  validateToken,
};
