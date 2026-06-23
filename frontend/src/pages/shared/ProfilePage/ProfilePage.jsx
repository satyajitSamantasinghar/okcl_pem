// ─────────────────────────────────────────────────────────────────────────────
//  ProfilePage.jsx — Shared across EMPLOYEE / RA / HRD / MD
//
//  Place this file at:  src/pages/shared/ProfilePage/ProfilePage.jsx
//  Route registration (in your router):
//    /employee/profile → <ProfilePage />
//    /ra/profile       → <ProfilePage />
//    /hrd/profile      → <ProfilePage />
//    /md/profile       → <ProfilePage />
//
//  Assumptions (match your existing codebase):
//  • authContext exposes { user, token } where user.role, user.name, user.userId
//  • API_BASE = process.env.REACT_APP_API_URL or import from config
//  • Your axios/fetch wrapper attaches the Authorization header automatically,
//    or replace the fetch calls below with your existing apiClient if you have one.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useRef } from "react";
import api from "../../../services/api";
import "./ProfilePage.css";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate initials avatar text — mirrors what your nav already does */
function getInitials(name = "") {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Role badge config — colours match your existing role badges in the nav */
const ROLE_CONFIG = {
  EMPLOYEE: { label: "Employee",          color: "#6366f1" },
  RA:       { label: "Reporting Authority", color: "#f97316" },
  HRD:      { label: "HRD",               color: "#0ea5e9" },
  MD:       { label: "Managing Director",  color: "#8b5cf6" },
};

/** Auth provider badge */
const PROVIDER_CONFIG = {
  local: { label: "Local Account",  icon: "🔑" },
  hrms:  { label: "HRMS SSO",       icon: "🏢" },
};

/** Friendly names for audit actions */
const ACTION_ICONS = {
  Submitted:     "📤",
  "Saved draft": "💾",
  "Updated draft":"✏️",
  Resubmitted:   "🔄",
  Evaluated:     "✅",
  Approved:      "✔️",
  Rejected:      "❌",
};

/** Format a date string to a readable form */
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** Format a date range: "Jan 2026 – present" or "Jan 2026 – Mar 2026" */
function fmtDateRange(from, to) {
  const opts = { month: "short", year: "numeric" };
  const start = from ? new Date(from).toLocaleDateString("en-IN", opts) : "—";
  const end   = to   ? new Date(to).toLocaleDateString("en-IN", opts)   : "Present";
  return `${start} – ${end}`;
}

/** Duration string: "3 months", "1 year 2 months", etc. */
function fmtDuration(from, to) {
  if (!from) return "";
  const start = new Date(from);
  const end   = to ? new Date(to) : new Date();
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  if (months < 1)  return "< 1 month";
  if (months < 12) return `${months} month${months > 1 ? "s" : ""}`;
  const yrs = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0
    ? `${yrs} yr${yrs > 1 ? "s" : ""} ${rem} mo`
    : `${yrs} yr${yrs > 1 ? "s" : ""}`;
}

/** Relative time (e.g. "2 hours ago") */
function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [profile,  setProfile]  = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [actLoading, setActLoading] = useState(false);
  const [error,    setError]    = useState(null);

  // Edit contact panel
  const [editMode,    setEditMode]    = useState(false);
  const [editValues,  setEditValues]  = useState({ email: "", phone: "" });
  const [editErrors,  setEditErrors]  = useState({});
  const [saving,      setSaving]      = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Change password panel
  const [pwMode,    setPwMode]    = useState(false);
  const [pwValues,  setPwValues]  = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [pwErrors,  setPwErrors]  = useState({});
  const [pwSaving,  setPwSaving]  = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [showPw,    setShowPw]    = useState({ current: false, new: false, confirm: false });

  // Toast
  const [toast, setToast] = useState(null);
  const toastRef = useRef(null);

  // ── Helpers ────────────────────────────────────────────────────────────────
  // Uses the shared api instance (services/api.js) which automatically:
  //   • attaches the Bearer token via request interceptor
  //   • uses VITE_API_URL in dev and '/api' (relative) in production
  //   • handles 401 / token refresh via response interceptor
  const authFetch = useCallback(async (url, opts = {}) => {
    const method = (opts.method || "GET").toLowerCase();
    const body   = opts.body ? JSON.parse(opts.body) : undefined;
    // Strip the leading '/api' prefix since api.js already sets the baseURL
    const path   = url.replace(/^\/api/, "");
    const res    = await api({ method, url: path, data: body, headers: opts.headers });
    return res.data;
  }, []);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 3500);
  };

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await authFetch("/api/profile/me");
      setProfile(data);
      setEditValues({ email: data.email || "", phone: data.phone || "" });
    } catch (err) {
      setError(err?.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  const fetchActivity = useCallback(async () => {
    try {
      setActLoading(true);
      const data = await authFetch("/api/profile/me/activity?limit=10&offset=0");
      setActivity(data.activity || []);
    } catch {
      setActivity([]);
    } finally {
      setActLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchProfile();
    fetchActivity();
  }, [fetchProfile, fetchActivity]);

  // ── Contact edit handlers ──────────────────────────────────────────────────
  const validateEdit = () => {
    const errs = {};
    if (editValues.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editValues.email)) {
      errs.email = "Enter a valid email address.";
    }
    if (editValues.phone && !/^\+?[\d\s\-()]{7,15}$/.test(editValues.phone)) {
      errs.phone = "Enter a valid phone number.";
    }
    return errs;
  };

  const handleSaveContact = async () => {
    const errs = validateEdit();
    if (Object.keys(errs).length) { setEditErrors(errs); return; }
    try {
      setSaving(true);
      setEditErrors({});
      const data = await authFetch("/api/profile/me", {
        method: "PUT",
        body:   JSON.stringify(editValues),
      });
      setProfile((prev) => ({ ...prev, ...data.user }));
      setEditMode(false);
      setSaveSuccess(true);
      showToast("Contact information updated successfully.");
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      setEditErrors({ server: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setEditErrors({});
    setEditValues({ email: profile?.email || "", phone: profile?.phone || "" });
  };

  // ── Password change handlers ───────────────────────────────────────────────
  const validatePassword = () => {
    const errs = {};
    if (!pwValues.currentPassword) errs.currentPassword = "Current password is required.";
    if (pwValues.newPassword.length < 8) errs.newPassword = "At least 8 characters required.";
    if (pwValues.newPassword !== pwValues.confirmPassword) errs.confirmPassword = "Passwords do not match.";
    return errs;
  };

  const handleChangePassword = async () => {
    const errs = validatePassword();
    if (Object.keys(errs).length) { setPwErrors(errs); return; }
    try {
      setPwSaving(true);
      setPwErrors({});
      await authFetch("/api/profile/me/password", {
        method: "PUT",
        body:   JSON.stringify({
          currentPassword: pwValues.currentPassword,
          newPassword:     pwValues.newPassword,
        }),
      });
      setPwMode(false);
      setPwValues({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPwSuccess(true);
      showToast("Password changed successfully.");
      setTimeout(() => setPwSuccess(false), 3000);
    } catch (err) {
      setPwErrors({ server: err.message });
    } finally {
      setPwSaving(false);
    }
  };

  // ── Role-specific stat cards ───────────────────────────────────────────────
  const renderRoleStats = () => {
    if (!profile?.roleStats) return null;
    const { role, roleStats } = profile;

    const cards = [];

    if (role === "EMPLOYEE") {
      cards.push(
        { label: "Monthly Plans",     value: roleStats.monthlyPlansSubmitted ?? 0,   icon: "📋" },
        { label: "Quarterly Evals",   value: roleStats.quarterlyEvalCount    ?? 0,   icon: "📊" },
        { label: "Yearly Plan",       value: roleStats.latestYearlyPlan?.status ?? "None", icon: "🎯", isTag: true },
      );
    }

    if (role === "RA") {
      cards.push(
        { label: "Direct Reports",    value: roleStats.directReportsCount   ?? 0,    icon: "👥" },
        { label: "Pending Evals",     value: roleStats.pendingEvaluations   ?? 0,    icon: "⏳", warn: roleStats.pendingEvaluations > 0 },
      );
    }

    if (role === "HRD") {
      cards.push(
        { label: "Total Employees",   value: roleStats.totalEmployees       ?? 0,    icon: "👤" },
        { label: "Total RAs",         value: roleStats.totalRAs             ?? 0,    icon: "👥" },
        { label: "Pending Appraisals",value: roleStats.pendingAppraisals    ?? 0,    icon: "⏳", warn: roleStats.pendingAppraisals > 0 },
      );
    }

    if (role === "MD") {
      cards.push(
        { label: "Plans Awaiting Approval",   value: roleStats.pendingYearlyPlanApprovals ?? 0, icon: "📝", warn: roleStats.pendingYearlyPlanApprovals > 0 },
        { label: "Appraisals to Review",      value: roleStats.pendingAppraisalReviews    ?? 0, icon: "⚖️",  warn: roleStats.pendingAppraisalReviews > 0 },
      );
    }

    if (!cards.length) return null;

    return (
      <div className="profile-section">
        <h3 className="profile-section-title">
          <span className="profile-section-icon">📈</span>
          Overview
        </h3>
        <div className="profile-stats-grid">
          {cards.map((card) => (
            <div
              key={card.label}
              className={`profile-stat-card ${card.warn ? "profile-stat-card--warn" : ""}`}
            >
              <span className="profile-stat-icon">{card.icon}</span>
              <div className="profile-stat-value">
                {card.isTag ? (
                  <span className={`status-tag status-tag--${card.value?.toLowerCase()}`}>
                    {card.value}
                  </span>
                ) : (
                  card.value
                )}
              </div>
              <div className="profile-stat-label">{card.label}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="profile-page">
        <div className="profile-skeleton-wrapper">
          <div className="profile-skeleton profile-skeleton--header" />
          <div className="profile-skeleton profile-skeleton--card" />
          <div className="profile-skeleton profile-skeleton--card" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="profile-page">
        <div className="profile-error-state">
          <span className="profile-error-icon">⚠️</span>
          <p className="profile-error-text">{error}</p>
          <button className="btn btn--primary" onClick={fetchProfile}>Try Again</button>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const roleConf     = ROLE_CONFIG[profile.role] || { label: profile.role, color: "#6b7280" };
  const providerConf = PROVIDER_CONFIG[profile.authProvider] || { label: profile.authProvider, icon: "🔐" };
  const initials     = getInitials(profile.name);
  const isHRMSUser   = profile.authProvider === "hrms";

  return (
    <div className="profile-page">

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`profile-toast profile-toast--${toast.type}`}>
          <span>{toast.type === "success" ? "✓" : "✕"}</span>
          {toast.message}
        </div>
      )}

      <div className="profile-layout">

        {/* ── LEFT COLUMN ─────────────────────────────────────────────────── */}
        <aside className="profile-sidebar">

          {/* Hero Card */}
          <div className="profile-hero-card">
            <div
              className="profile-avatar"
              style={{ "--role-color": roleConf.color }}
            >
              {initials}
            </div>
            <h1 className="profile-name">{profile.name}</h1>
            <span
              className="profile-role-badge"
              style={{ background: `${roleConf.color}20`, color: roleConf.color, border: `1px solid ${roleConf.color}40` }}
            >
              {roleConf.label}
            </span>
            {profile.designation && (
              <p className="profile-designation">{profile.designation}</p>
            )}
            {profile.department && (
              <p className="profile-department">
                <span className="profile-dept-icon">🏢</span>
                {profile.department}
              </p>
            )}
            <div className="profile-provider-badge">
              <span>{providerConf.icon}</span>
              <span>{providerConf.label}</span>
            </div>
            <p className="profile-member-since">
              Member since {fmtDate(profile.createdAt)}
            </p>
          </div>

          {/* Role Stats */}
          {renderRoleStats()}

        </aside>

        {/* ── RIGHT COLUMN ────────────────────────────────────────────────── */}
        <main className="profile-main">

          {/* ── Identity Panel (read-only) ─────────────────────────────────── */}
          <div className="profile-section profile-card">
            <div className="profile-section-header">
              <h3 className="profile-section-title">
                <span className="profile-section-icon">🪪</span>
                Identity
              </h3>
              <span className="profile-managed-badge">
                <span>🔒</span>
                Managed by HR
              </span>
            </div>
            <div className="profile-fields-grid">
              <ProfileField label="Employee Code" value={profile.employeeCode} />
              <ProfileField label="Role"          value={roleConf.label} />
              <ProfileField label="Department"    value={profile.department} />
              <ProfileField label="Designation"   value={profile.designation} />
              {profile.reportingAuthority && (
                <ProfileField
                  label="Reporting Authority"
                  value={profile.reportingAuthority.name}
                  sub={`${profile.reportingAuthority.designation || ""} · ${profile.reportingAuthority.employeeCode}`}
                  span
                />
              )}
            </div>
          </div>

          {/* ── RA History Panel ──────────────────────────────────────────── */}
          {profile.raHistory && profile.raHistory.length > 0 && (
            <div className="profile-section profile-card">
              <div className="profile-section-header">
                <h3 className="profile-section-title">
                  <span className="profile-section-icon">👥</span>
                  Reporting Authority History
                </h3>
                <span className="profile-managed-badge">
                  <span>📋</span>
                  {profile.raHistory.length} record{profile.raHistory.length !== 1 ? "s" : ""}
                </span>
              </div>

              <ol className="ra-history-timeline">
                {profile.raHistory.map((entry, idx) => (
                  <li
                    key={`${entry.ra.id}-${entry.effectiveFrom}`}
                    className={`ra-history-item ${entry.isCurrent ? "ra-history-item--current" : ""}`}
                  >
                    {/* Timeline spine dot */}
                    <div className="ra-history-dot">
                      {entry.isCurrent ? (
                        <span className="ra-history-dot-active" title="Current RA" />
                      ) : (
                        <span className="ra-history-dot-past" />
                      )}
                      {idx < profile.raHistory.length - 1 && (
                        <span className="ra-history-spine" />
                      )}
                    </div>

                    {/* Card body */}
                    <div className="ra-history-body">
                      <div className="ra-history-card">
                        <div className="ra-history-top">
                          {/* RA avatar initials */}
                          <div
                            className="ra-history-avatar"
                            style={{ "--ra-color": entry.isCurrent ? "#f97316" : "#9ca3af" }}
                          >
                            {getInitials(entry.ra.name)}
                          </div>
                          <div className="ra-history-info">
                            <span className="ra-history-name">{entry.ra.name}</span>
                            {entry.ra.designation && (
                              <span className="ra-history-desig">{entry.ra.designation}</span>
                            )}
                            {entry.ra.employeeCode && (
                              <span className="ra-history-code">{entry.ra.employeeCode}</span>
                            )}
                          </div>
                          {entry.isCurrent && (
                            <span className="ra-history-current-badge">Current</span>
                          )}
                        </div>

                        <div className="ra-history-meta">
                          <span className="ra-history-range" title={`From: ${fmtDate(entry.effectiveFrom)}`}>
                            🗓 {fmtDateRange(entry.effectiveFrom, entry.effectiveTo)}
                          </span>
                          <span className="ra-history-duration">
                            {fmtDuration(entry.effectiveFrom, entry.effectiveTo)}
                          </span>
                        </div>

                        {entry.assignedBy && (
                          <p className="ra-history-assigned-by">
                            Assigned by {entry.assignedBy.name}
                            {entry.assignedBy.designation ? ` · ${entry.assignedBy.designation}` : ""}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* ── Contact Panel ────────────────────────────────────────────── */}
          {/* HRMS users: read-only + sync notice. Local users: editable.   */}
          <div className="profile-section profile-card">
            <div className="profile-section-header">
              <h3 className="profile-section-title">
                <span className="profile-section-icon">📬</span>
                Contact Information
              </h3>

              {/* Edit button — only shown for local account users */}
              {!isHRMSUser && !editMode && (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => setEditMode(true)}
                >
                  <span>✏️</span> Edit
                </button>
              )}

              {/* HRMS badge — shown instead of Edit button for SSO users */}
              {isHRMSUser && (
                <span className="profile-managed-badge profile-managed-badge--hrms">
                  <span>🔄</span>
                  Synced from HRMS
                </span>
              )}
            </div>

            {/* HRMS users always see read-only fields + an informational notice */}
            {isHRMSUser ? (
              <>
                <div className="profile-fields-grid">
                  <ProfileField
                    label="Email Address"
                    value={profile.email}
                    icon="✉️"
                    empty="Not set"
                  />
                  <ProfileField
                    label="Phone Number"
                    value={profile.phone}
                    icon="📱"
                    empty="Not set"
                  />
                </div>
                {/* Informational notice — explains why editing is unavailable */}
                <div className="profile-hrms-contact-notice">
                  <span className="profile-hrms-contact-notice-icon">ℹ️</span>
                  <p>
                    Your contact details are managed by the HRMS system and
                    automatically synced on each login. To update your email
                    or phone number, please make the change in the HRMS portal
                    — it will reflect here on your next sign-in.
                  </p>
                </div>
              </>
            ) : editMode ? (
              /* Local users — inline edit form */
              <div className="profile-edit-form">
                <div className="profile-edit-field">
                  <label className="profile-label" htmlFor="edit-email">
                    Email Address
                  </label>
                  <input
                    id="edit-email"
                    type="email"
                    className={`profile-input ${editErrors.email ? "profile-input--error" : ""}`}
                    value={editValues.email}
                    onChange={(e) => setEditValues((v) => ({ ...v, email: e.target.value }))}
                    placeholder="you@company.com"
                    autoComplete="email"
                  />
                  {editErrors.email && <span className="profile-field-error">{editErrors.email}</span>}
                </div>
                <div className="profile-edit-field">
                  <label className="profile-label" htmlFor="edit-phone">
                    Phone Number
                  </label>
                  <input
                    id="edit-phone"
                    type="tel"
                    className={`profile-input ${editErrors.phone ? "profile-input--error" : ""}`}
                    value={editValues.phone}
                    onChange={(e) => setEditValues((v) => ({ ...v, phone: e.target.value }))}
                    placeholder="+91 98765 43210"
                    autoComplete="tel"
                  />
                  {editErrors.phone && <span className="profile-field-error">{editErrors.phone}</span>}
                </div>
                {editErrors.server && (
                  <p className="profile-server-error">{editErrors.server}</p>
                )}
                <div className="profile-edit-actions">
                  <button className="btn btn--ghost btn--sm" onClick={handleCancelEdit} disabled={saving}>
                    Cancel
                  </button>
                  <button className="btn btn--primary btn--sm" onClick={handleSaveContact} disabled={saving}>
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              </div>
            ) : (
              /* Local users — read-only display */
              <div className="profile-fields-grid">
                <ProfileField
                  label="Email Address"
                  value={profile.email}
                  icon="✉️"
                  empty="Not set"
                />
                <ProfileField
                  label="Phone Number"
                  value={profile.phone}
                  icon="📱"
                  empty="Not set"
                />
              </div>
            )}
          </div>

          {/* ── Security Panel ────────────────────────────────────────────── */}
          {/* Entirely hidden for HRMS SSO users — password lifecycle lives  */}
          {/* in the HRMS portal; showing any security UI here would mislead */}
          {/* them into thinking they can manage credentials in this system.  */}
          {!isHRMSUser && (
            <div className="profile-section profile-card">
              <div className="profile-section-header">
                <h3 className="profile-section-title">
                  <span className="profile-section-icon">🔐</span>
                  Security
                </h3>
              </div>

              {pwMode ? (
                <div className="profile-edit-form">
                  {[
                    { key: "currentPassword", label: "Current Password",    id: "pw-current" },
                    { key: "newPassword",      label: "New Password",        id: "pw-new"     },
                    { key: "confirmPassword",  label: "Confirm New Password", id: "pw-confirm" },
                  ].map(({ key, label, id }) => (
                    <div className="profile-edit-field" key={key}>
                      <label className="profile-label" htmlFor={id}>{label}</label>
                      <div className="profile-pw-wrapper">
                        <input
                          id={id}
                          type={showPw[key.replace("Password","").replace("current","current").replace("new","new").replace("confirm","confirm")] ? "text" : "password"}
                          className={`profile-input ${pwErrors[key] ? "profile-input--error" : ""}`}
                          value={pwValues[key]}
                          onChange={(e) => setPwValues((v) => ({ ...v, [key]: e.target.value }))}
                          autoComplete={key === "currentPassword" ? "current-password" : "new-password"}
                        />
                        <button
                          type="button"
                          className="profile-pw-toggle"
                          onClick={() => setShowPw((s) => ({ ...s, [key.replace("Password","").toLowerCase().replace("current","current").replace("new","new").replace("confirm","confirm")]: !s[key.replace("Password","").toLowerCase()] }))}
                        >
                          {showPw[key] ? "🙈" : "👁"}
                        </button>
                      </div>
                      {pwErrors[key] && <span className="profile-field-error">{pwErrors[key]}</span>}
                    </div>
                  ))}
                  {pwErrors.server && <p className="profile-server-error">{pwErrors.server}</p>}
                  <div className="profile-edit-actions">
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => { setPwMode(false); setPwErrors({}); setPwValues({ currentPassword: "", newPassword: "", confirmPassword: "" }); }}
                      disabled={pwSaving}
                    >
                      Cancel
                    </button>
                    <button className="btn btn--primary btn--sm" onClick={handleChangePassword} disabled={pwSaving}>
                      {pwSaving ? "Updating…" : "Update Password"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="profile-security-row">
                  <div className="profile-security-info">
                    <p className="profile-security-label">Password</p>
                    <p className="profile-security-sub">••••••••••••</p>
                  </div>
                  <button className="btn btn--ghost btn--sm" onClick={() => setPwMode(true)}>
                    Change Password
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Recent Activity ───────────────────────────────────────────── */}
          <div className="profile-section profile-card">
            <div className="profile-section-header">
              <h3 className="profile-section-title">
                <span className="profile-section-icon">🕐</span>
                Recent Activity
              </h3>
            </div>
            {actLoading ? (
              <div className="profile-activity-skeleton">
                {[1,2,3].map((i) => (
                  <div key={i} className="profile-skeleton profile-skeleton--activity" />
                ))}
              </div>
            ) : activity.length === 0 ? (
              <p className="profile-empty-activity">No recent activity recorded yet.</p>
            ) : (
              <ol className="profile-activity-list">
                {activity.map((log) => (
                  <li key={log.id} className="profile-activity-item">
                    <span className="profile-activity-icon">
                      {ACTION_ICONS[log.action] || "📌"}
                    </span>
                    <div className="profile-activity-body">
                      <span className="profile-activity-action">{log.action}</span>
                      <span className="profile-activity-entity"> · {log.entity}</span>
                    </div>
                    <span className="profile-activity-time" title={fmtDateTime(log.createdAt)}>
                      {timeAgo(log.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

        </main>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-component: ProfileField
//  A single labelled read-only field.
// ─────────────────────────────────────────────────────────────────────────────
function ProfileField({ label, value, sub, icon, empty = "—", span = false }) {
  return (
    <div className={`profile-field ${span ? "profile-field--span" : ""}`}>
      <span className="profile-field-label">{label}</span>
      <span className="profile-field-value">
        {icon && <span className="profile-field-icon">{icon}</span>}
        {value || <em className="profile-field-empty">{empty}</em>}
      </span>
      {sub && <span className="profile-field-sub">{sub}</span>}
    </div>
  );
}