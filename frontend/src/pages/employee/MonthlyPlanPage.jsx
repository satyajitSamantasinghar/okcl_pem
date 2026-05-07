import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiSend, FiFileText, FiCheckCircle, FiX, FiCalendar,
    FiTrendingUp, FiMessageSquare, FiClock, FiPlus, FiChevronRight,
    FiSave, FiSearch, FiEdit3, FiAlertCircle, FiRefreshCw, FiStar
} from 'react-icons/fi';
import './MonthlyPlanPage.css';
// FISCAL YEAR FIX — shared fiscal utility
import { getFiscalMonthOrder } from '../../utils/fiscalUtils';

/* ====================================================
   HELPERS
==================================================== */
const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
// FISCAL YEAR FIX — was January-December order; now April-March (fiscal year order)
const months = getFiscalMonthOrder();

function formatMonth(monthStr) {
    if (!monthStr) return 'N/A';
    const [y, m] = monthStr.split('-');
    return new Date(y, parseInt(m) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function shortMonth(monthStr) {
    if (!monthStr) return '';
    const [, m] = monthStr.split('-');
    return new Date(2024, parseInt(m) - 1).toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
}

function shortYear(monthStr) {
    if (!monthStr) return '';
    const [y] = monthStr.split('-');
    return y.slice(2);
}

function shortDay(monthStr) {
    if (!monthStr) return '';
    const [y, m] = monthStr.split('-');
    // Return last 2 digits of year as "day-like" display (matches screenshot 4 style)
    return new Date(y, parseInt(m) - 1).toLocaleDateString('en-US', { day: '2-digit' });
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateShort(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getProgressTokens(progress) {
    const p = Math.min(100, Math.max(0, progress || 0));
    if (p === 100) return {
        label: 'Completed', ringColor: '#16A34A', barColor: '#16A34A',
        badgeBg: '#F0FDF4', badgeText: '#15803D',
        borderColor: '#16A34A', pctClass: 'pp-green', markerActive: 4
    };
    if (p >= 75) return {
        label: 'Almost done', ringColor: '#D97706', barColor: '#F59E0B',
        badgeBg: '#FFFBEB', badgeText: '#B45309',
        borderColor: '#F59E0B', pctClass: 'pp-amber', markerActive: 3
    };
    if (p >= 50) return {
        label: 'Halfway', ringColor: '#EA580C', barColor: '#F97316',
        badgeBg: '#FFF7ED', badgeText: '#C2410C',
        borderColor: '#F97316', pctClass: 'pp-orange', markerActive: 2
    };
    if (p >= 25) return {
        label: 'Just started', ringColor: '#D97706', barColor: '#F59E0B',
        badgeBg: '#FFFBEB', badgeText: '#B45309',
        borderColor: '#F59E0B', pctClass: 'pp-amber', markerActive: 1
    };
    return {
        label: 'Not started', ringColor: '#DC2626', barColor: '#EF4444',
        badgeBg: '#FEF2F2', badgeText: '#B91C1C',
        borderColor: '#EF4444', pctClass: 'pp-red', markerActive: 0
    };
}

function getPlanItems(plan) {
    if (!plan) return [];
    if (Array.isArray(plan.planItems) && plan.planItems.filter(Boolean).length > 0)
        return plan.planItems.filter(Boolean);
    if (plan.planDetails)
        return plan.planDetails.split('\n').map(s => s.trim()).filter(Boolean);
    return [];
}

function parseLegacyPlanAch(legacyText, planCount) {
    const result = Array.from({ length: planCount }, () => ({ achievementDetails: '', progress: 0 }));
    if (!legacyText) return result;
    const lines = legacyText.split('\n');
    let currentIdx = -1;
    lines.forEach(line => {
        const withPct = line.match(/^Plan\s+(\d+)\s*\[(\d+)%\]:\s*(.*)/i);
        const withoutPct = !withPct && line.match(/^Plan\s+(\d+):\s*(.*)/i);
        if (withPct) {
            const idx = parseInt(withPct[1]) - 1;
            if (idx >= 0 && idx < planCount) {
                currentIdx = idx;
                result[idx].progress = Math.min(100, parseInt(withPct[2]) || 0);
                result[idx].achievementDetails = withPct[3].trim();
            }
        } else if (withoutPct) {
            const idx = parseInt(withoutPct[1]) - 1;
            if (idx >= 0 && idx < planCount) {
                currentIdx = idx;
                result[idx].achievementDetails = withoutPct[2].trim();
            }
        } else if (currentIdx >= 0 && line.trim() && !line.match(/^Additional:/i)) {
            result[currentIdx].achievementDetails +=
                (result[currentIdx].achievementDetails ? ' ' : '') + line.trim();
        }
    });
    return result;
}

function getEffectivePlanAch(ach, planCount) {
    if (!ach) return null;
    const pa = ach.planAchievements;
    if (Array.isArray(pa) && pa.length > 0) {
        const hasRealData = pa.some(a => (a.achievementDetails || '').trim() || (a.progress || 0) > 0);
        if (hasRealData) return pa;
    }
    if (ach.achievementDetails) {
        const parsed = parseLegacyPlanAch(ach.achievementDetails, planCount);
        const hasParsedData = parsed.some(a => (a.achievementDetails || '').trim() || (a.progress || 0) > 0);
        if (hasParsedData) return parsed;
    }
    return null;
}

function parseAdditionalAch(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter(a => (a.text || '').trim());
    } catch { /* fall through */ }
    return raw.split('\n')
        .filter(l => l.trim() && !l.trim().startsWith('Additional:'))
        .map(t => ({ text: t.trim(), progress: 100 }));
}

const MONTH_PALETTES = [
    { bg: '#E6F1FB', color: '#0C447C' }, { bg: '#EAF3DE', color: '#27500A' },
    { bg: '#FAEEDA', color: '#633806' }, { bg: '#FCEBEB', color: '#791F1F' },
    { bg: '#EEEDFE', color: '#3C3489' }, { bg: '#E1F5EE', color: '#085041' },
    { bg: '#FAECE7', color: '#712B13' }, { bg: '#FFF0EB', color: '#993C1D' },
    { bg: '#E6F1FB', color: '#0C447C' }, { bg: '#EAF3DE', color: '#27500A' },
    { bg: '#FAEEDA', color: '#633806' }, { bg: '#EEEDFE', color: '#3C3489' },
];

function getMonthChipStyle(monthStr) {
    if (!monthStr) return MONTH_PALETTES[0];
    const m = parseInt(monthStr.split('-')[1]) - 1;
    return MONTH_PALETTES[m] || MONTH_PALETTES[0];
}

/* ── Circular Progress Ring ── */
function CircularProgress({ progress, size = 46 }) {
    const p = Math.min(100, Math.max(0, progress || 0));
    const r = (size - 6) / 2;
    const circ = 2 * Math.PI * r;
    const dash = (p / 100) * circ;
    const tk = getProgressTokens(p);
    return (
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E2E8F0" strokeWidth={4.5} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={tk.ringColor} strokeWidth={4.5}
                strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.35s ease' }} />
            <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="middle"
                style={{
                    transform: `rotate(90deg)`,
                    transformOrigin: `${size / 2}px ${size / 2}px`,
                    fontSize: 9.5, fontWeight: 700,
                    fill: '#1E293B', fontFamily: 'inherit'
                }}>
                {p}%
            </text>
        </svg>
    );
}

function DonutChart({ value, size = 68 }) {
    const p = Math.min(100, Math.max(0, value || 0));
    const r = (size - 10) / 2;
    const circ = 2 * Math.PI * r;
    const dash = (p / 100) * circ;
    const color = p >= 70 ? '#16A34A' : p >= 40 ? '#F59E0B' : '#94A3B8';
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E2E8F0" strokeWidth={7} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={7}
                strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={{ transition: 'stroke-dasharray 0.5s ease' }} />
        </svg>
    );
}

/* ── Progress Bar ── */
function ProgressBar({ value, height = 6, color }) {
    const p = Math.min(100, Math.max(0, value || 0));
    const tk = getProgressTokens(p);
    const barColor = color || tk.barColor;
    return (
        <div className="mp-progress-track" style={{ height }}>
            <div style={{ width: `${p}%`, height: '100%', background: barColor, borderRadius: 99, transition: 'width 0.4s ease' }} />
        </div>
    );
}

/* ====================================================
   MAIN COMPONENT
==================================================== */
/* ── Derived from env var once at component scope ── */
const ENFORCE_DEADLINES = import.meta.env.VITE_ENFORCE_DEADLINES !== 'false';

const MonthlyPlanPage = () => {
    const [plans, setPlans] = useState([]);
    const [achievements, setAchievements] = useState([]);
    const [evaluations, setEvaluations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterYear, setFilterYear] = useState(currentYear);
    const [filterMonth, setFilterMonth] = useState('');

    const [showPlanForm, setShowPlanForm] = useState(false);
    // In enforced mode, the month is always locked to the current month.
    const today_init = new Date();
    const currentMonthDefault = `${today_init.getFullYear()}-${String(today_init.getMonth() + 1).padStart(2, '0')}`;
    const [planMonth, setPlanMonth] = useState(ENFORCE_DEADLINES ? currentMonthDefault : '');
    // Dev-mode custom picker state
    const [pickerYear, setPickerYear] = useState(today_init.getFullYear());
    const [planItems, setPlanItems] = useState(['']);
    const [submitting, setSubmitting] = useState(false);

    const [achModal, setAchModal] = useState(null);
    const [achItems, setAchItems] = useState([]);
    const [additionalAchItems, setAdditionalAchItems] = useState([{ text: '', progress: 0 }]);

    const [selectedPlan, setSelectedPlan] = useState(null);
    const [resubmitPlan, setResubmitPlan] = useState(null);
    const [resubmitItems, setResubmitItems] = useState(['']);

    const fetchData = async () => {
        try {
            const [plansRes, achievementsRes, evalsRes] = await Promise.all([
                api.get('/employee/monthly-plans'),
                api.get('/employee/monthly-achievements'),
                api.get('/ra/monthly-evaluations', { params: { limit: 100 } }),
            ]);
            setPlans(plansRes.data);
            setAchievements(achievementsRes.data);
            setEvaluations(evalsRes.data?.data || []);
        } catch {
            toast.error('Failed to load data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    const achievementByPlanId = useMemo(() => {
        const map = {};
        achievements.forEach(a => {
            const planId = a.monthlyPlanId?._id || a.monthlyPlanId;
            if (planId) map[planId] = a;
        });
        return map;
    }, [achievements]);

    const evaluationByMonth = useMemo(() => {
        const map = {};
        evaluations.forEach(ev => { if (ev.month) map[ev.month] = ev; });
        return map;
    }, [evaluations]);

    const filteredPlans = useMemo(() => {
        return plans.filter(p => {
            if (!p.month?.startsWith(String(filterYear))) return false;
            if (filterMonth && !p.month.endsWith(filterMonth)) return false;
            return true;
        }).sort((a, b) => b.month.localeCompare(a.month));
    }, [plans, filterYear, filterMonth]);

    const stats = useMemo(() => {
        const yearPlans = plans.filter(p => p.month?.startsWith(String(filterYear)));
        const total = yearPlans.length;
        const withAch = yearPlans.filter(p => { const a = achievementByPlanId[p._id]; return a && a.status !== 'DRAFT'; }).length;
        const drafts = yearPlans.filter(p => { const a = achievementByPlanId[p._id]; return a && a.status === 'DRAFT'; }).length;
        const evaluated = yearPlans.filter(p => { const ev = evaluationByMonth[p.month]; return ev && ev.status === 'EVALUATED'; }).length;
        return { total, withAch, drafts, evaluated };
    }, [plans, filterYear, achievementByPlanId, evaluationByMonth]);

    const getProgress = (plan) => {
        const ach = achievementByPlanId[plan._id];
        const ev = evaluationByMonth[plan.month];
        const isEval = ev && ev.status === 'EVALUATED';
        const isPlanDraft = plan.status === 'DRAFT';
        return {
            planDone: !isPlanDraft, isPlanDraft,
            achDone: ach && ach.status !== 'DRAFT',
            isDraft: ach?.status === 'DRAFT',
            evalDone: isEval
        };
    };

    const getStatusInfo = (plan) => {
        const p = getProgress(plan);
        if (p.isPlanDraft) return { label: 'Plan draft', cls: 'draft' };
        if (p.evalDone) return { label: 'Evaluated', cls: 'evaluated' };
        if (p.achDone) return { label: 'Achievement added', cls: 'achievement' };
        if (p.isDraft) return { label: 'Draft saved', cls: 'draft' };
        if (plan.status === 'REJECTED') return { label: 'Rejected', cls: 'rejected' };
        return { label: 'Plan submitted', cls: 'submitted' };
    };

    const addPlanItem = (afterIndex) => { const next = [...planItems]; next.splice(afterIndex + 1, 0, ''); setPlanItems(next); };
    const updatePlanItem = (index, value) => { const next = [...planItems]; next[index] = value; setPlanItems(next); };
    const removePlanItem = (index) => { if (planItems.length === 1) return; setPlanItems(planItems.filter((_, i) => i !== index)); };

    const addResubmitItem = (afterIndex) => { const next = [...resubmitItems]; next.splice(afterIndex + 1, 0, ''); setResubmitItems(next); };
    const updateResubmitItem = (index, value) => { const next = [...resubmitItems]; next[index] = value; setResubmitItems(next); };
    const removeResubmitItem = (index) => { if (resubmitItems.length === 1) return; setResubmitItems(resubmitItems.filter((_, i) => i !== index)); };

    const updateAchItem = (index, field, value) => { const next = [...achItems]; next[index] = { ...next[index], [field]: value }; setAchItems(next); };
    const addAdditionalItem = (afterIndex) => { const next = [...additionalAchItems]; next.splice(afterIndex + 1, 0, { text: '', progress: 0 }); setAdditionalAchItems(next); };
    const updateAdditionalItem = (index, field, value) => { const next = [...additionalAchItems]; next[index] = { ...next[index], [field]: value }; setAdditionalAchItems(next); };
    const removeAdditionalItem = (index) => {
        if (additionalAchItems.length === 1) { setAdditionalAchItems([{ text: '', progress: 0 }]); return; }
        setAdditionalAchItems(additionalAchItems.filter((_, i) => i !== index));
    };

    const handleSubmitPlan = async (e, asDraft = false) => {
        if (e) e.preventDefault();
        const filled = planItems.filter(p => p.trim());
        if (!planMonth) { toast.error('Please select a month'); return; }
        if (filled.length === 0) { toast.error('Please add at least one plan'); return; }

        if (import.meta.env.VITE_ENFORCE_DEADLINES !== 'false') {
            const today = new Date();
            const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
            if (planMonth !== currentMonthStr) {
                toast.error(`You can only submit a monthly plan for the current month (${currentMonthStr}).`);
                return;
            }
            if (today.getDate() < 1 || today.getDate() > 7) {
                toast.error("Monthly plan submission allowed only from 1st to 7th.");
                return;
            }
        }

        setSubmitting(true);
        try {
            await api.post('/employee/monthly-plan', { month: planMonth, planItems: filled, planDetails: filled.join('\n'), status: asDraft ? 'DRAFT' : 'PENDING' });
            toast.success(asDraft ? 'Plan saved as draft!' : 'Monthly plan submitted!');
            setPlanMonth(''); setPlanItems(['']); setShowPlanForm(false);
            fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Submission failed');
        } finally { setSubmitting(false); }
    };

    const openAchModal = (plan) => {
        const existing = achievementByPlanId[plan._id];
        const itemList = getPlanItems(plan);
        setAchModal(plan);
        if (existing) {
            const effective = getEffectivePlanAch(existing, itemList.length);
            setAchItems(itemList.map((_, i) => ({ achievementDetails: effective?.[i]?.achievementDetails || '', progress: effective?.[i]?.progress || 0 })));
            if (existing.additionalAchievement) {
                const parsed = parseAdditionalAch(existing.additionalAchievement);
                setAdditionalAchItems(parsed.length ? parsed : [{ text: '', progress: 0 }]);
            } else { setAdditionalAchItems([{ text: '', progress: 0 }]); }
        } else {
            setAchItems(itemList.map(() => ({ achievementDetails: '', progress: 0 })));
            setAdditionalAchItems([{ text: '', progress: 0 }]);
        }
    };

    const openResubmitModal = (plan) => { setResubmitPlan(plan); const items = getPlanItems(plan); setResubmitItems(items.length ? items : ['']); };

    const handleResubmitPlan = async (asDraft = false) => {
        const filled = resubmitItems.filter(p => p.trim());
        if (filled.length === 0) { toast.error('Please enter at least one plan'); return; }

        if (resubmitPlan.status === 'REJECTED' && !asDraft) {
            const originalItems = getPlanItems(resubmitPlan);
            const isSame = filled.length === originalItems.length &&
                filled.every((item, i) => item.trim() === originalItems[i].trim());

            if (isSame) {
                toast.error('You must modify the plan before resubmitting. Please add or change your plan details.');
                return;
            }
        }

        setSubmitting(true);
        try {
            await api.post('/employee/monthly-plan', { month: resubmitPlan.month, planItems: filled, planDetails: filled.join('\n'), status: asDraft ? 'DRAFT' : 'PENDING' });
            toast.success(asDraft ? 'Draft saved!' : (resubmitPlan.status === 'DRAFT' ? 'Plan submitted!' : 'Plan resubmitted!'));
            setResubmitPlan(null); setResubmitItems(['']);
            fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Submission failed');
        } finally { setSubmitting(false); }
    };

    const handleAchSubmit = async (asDraft) => {
        if (import.meta.env.VITE_ENFORCE_DEADLINES !== 'false') {
            const today = new Date();
            const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
            if (achModal.month !== currentMonthStr) {
                toast.error(`You can only submit a monthly achievement for the current month (${currentMonthStr}).`);
                return;
            }
            if (today.getDate() < 25) {
                toast.error("Monthly achievement submission allowed from 25th onwards.");
                return;
            }
        }

        if (!asDraft) {
            const missingIndex = achItems.findIndex(a => !(a.achievementDetails || '').trim());
            if (missingIndex !== -1) {
                toast.error(`Plan ${missingIndex + 1} achievement is pending. Please write it before submitting.`);
                return;
            }
        } else {
            const hasAny = achItems.some(a => (a.achievementDetails || '').trim()) || additionalAchItems.some(a => (a.text || '').trim());
            if (!hasAny) { toast.error('Please describe at least one achievement to save as draft'); return; }
        }

        setSubmitting(true);
        const filledAdditional = additionalAchItems.filter(a => a.text.trim());
        const additionalStr = filledAdditional.length ? JSON.stringify(filledAdditional) : '';
        const legacyDetails = achItems.map((a, i) => `Plan ${i + 1} [${a.progress || 0}%]: ${a.achievementDetails || '—'}`).join('\n') + (additionalStr ? `\nAdditional: ${additionalStr}` : '');
        try {
            await api.post('/employee/monthly-achievement', {
                monthlyPlanId: achModal._id,
                planAchievements: achItems.map((a, i) => ({ planIndex: i, achievementDetails: a.achievementDetails || '', progress: a.progress || 0 })),
                additionalAchievement: additionalStr, achievementDetails: legacyDetails,
                status: asDraft ? 'DRAFT' : 'SUBMITTED',
            });
            toast.success(asDraft ? 'Draft saved!' : 'Achievement submitted!');
            setAchModal(null); setAchItems([]); setAdditionalAchItems([{ text: '', progress: 0 }]);
            fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed');
        } finally { setSubmitting(false); }
    };

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p>Loading monthly plans...</p>
            </div>
        );
    }

    /* ── REUSABLE: PLAN BOX ROW ── */
    const renderPlanBox = (item, index, items, onUpdate, onAdd, onRemove) => (
        <div key={index} className="mp-plan-box-row">
            <div className="mp-plan-box-content">
                <div className="mp-plan-box-header">
                    <span className="mp-plan-seq-num">{index + 1}</span>
                    <span className="mp-plan-box-label">Plan {index + 1}</span>
                    {items.length > 1 && (
                        <button className="mp-plan-box-remove" onClick={() => onRemove(index)} type="button"><FiX /></button>
                    )}
                </div>
                <textarea
                    className={`mp-plan-box-textarea${item ? ' filled' : ''}`}
                    value={item}
                    onChange={e => onUpdate(index, e.target.value)}
                    placeholder={`Describe your work plan ${index + 1} for this month...`}
                />
            </div>
            <button className="mp-plan-add-btn" onClick={() => onAdd(index)} type="button" title="Add another plan below"><FiPlus /></button>
        </div>
    );

    const renderAdditionalBox = (item, index) => {
        const safeProgress = Math.min(100, item.progress || 0);
        const tk = getProgressTokens(safeProgress);
        return (
            <div key={index} className="mp-plan-box-row" style={{ alignItems: 'flex-start' }}>
                <div className="mp-ach-item-row mp-ach-item-row--amber" style={{ borderLeftColor: tk.borderColor, flex: 1, minWidth: 0, marginTop: 0 }}>
                    <div className="mp-ach-item-header">
                        <CircularProgress progress={safeProgress} size={48} />
                        <div className="mp-ach-item-plan-info">
                            <div className="mp-ach-item-plan-num">
                                <span className="mp-plan-seq-num mp-plan-seq-num--amber mp-plan-seq-num--sm">{index + 1}</span>
                                Extra Achievement {index + 1}
                            </div>
                        </div>
                        {(additionalAchItems.length > 1 || item.text) && (
                            <button className="mp-plan-box-remove" onClick={() => removeAdditionalItem(index)} type="button"><FiX /></button>
                        )}
                    </div>
                    <div className="mp-ach-progress-controls">
                        <label className="mp-ach-ctrl-label">Progress</label>
                        <div className="mp-ach-slider-wrap">
                            <div className="mp-ach-slider-track-bg">
                                <div className="mp-ach-slider-fill" style={{ width: `${safeProgress}%`, background: tk.barColor }} />
                                <input type="range" min={0} max={100} step={5}
                                    value={safeProgress}
                                    onChange={e => updateAdditionalItem(index, 'progress', parseInt(e.target.value))}
                                    className="mp-ach-range"
                                    style={{ '--thumb-color': tk.ringColor }}
                                />
                            </div>
                            <span className="mp-ach-slider-pct" style={{ color: tk.ringColor }}>{safeProgress}%</span>
                        </div>
                        <div className="mp-ach-progress-btns">
                            {[0, 25, 50, 75, 100].map(v => (
                                <button key={v} type="button"
                                    className={`mp-ach-prog-btn${safeProgress === v ? ' active' : ''}`}
                                    style={safeProgress === v ? { background: tk.barColor, borderColor: tk.barColor } : {}}
                                    onClick={() => updateAdditionalItem(index, 'progress', v)}>
                                    {v === 100 ? '✓ Done' : `${v}%`}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="mp-ach-item-textarea-wrap">
                        <label className="mp-ach-ctrl-label" style={{ color: '#854F0B' }}>ACHIEVEMENT DETAILS</label>
                        <textarea
                            className={`mp-plan-box-textarea mp-plan-box-textarea--amber${item.text ? ' filled-amber' : ''}`}
                            value={item.text}
                            onChange={e => updateAdditionalItem(index, 'text', e.target.value)}
                            placeholder={`Describe extra achievement ${index + 1}...`}
                            rows={3}
                            style={{ background: 'transparent' }}
                        />
                    </div>
                </div>
                <button className="mp-plan-add-btn" onClick={() => addAdditionalItem(index)} type="button" title="Add another extra achievement"><FiPlus /></button>
            </div>
        );
    };

    /* ======================================================
       ACHIEVEMENT MODAL
    ====================================================== */
    const renderAchModal = () => {
        if (!achModal) return null;
        const existing = achievementByPlanId[achModal._id];
        const isDraft = existing?.status === 'DRAFT';
        const planItemsList = getPlanItems(achModal);
        const overallProgress = achItems.length > 0
            ? Math.round(achItems.reduce((s, a) => s + (Math.min(100, a.progress || 0)), 0) / achItems.length) : 0;
        const completedCount = achItems.filter(a => a.progress >= 100).length;

        return createPortal(
            <div className="mp-overlay" onClick={() => setAchModal(null)}>
                <div className="mp-ach-modal mp-ach-modal--wide" onClick={e => e.stopPropagation()}>
                    <div className="mp-ach-modal-header mp-ach-modal-header--green">
                        <div>
                            <h2>{formatMonth(achModal.month)}</h2>
                            <p className="mp-ach-subtitle">
                                {isDraft ? 'Continue editing your draft' : `Submit achievements for ${planItemsList.length} plan${planItemsList.length > 1 ? 's' : ''}`}
                            </p>
                        </div>
                        <button className="mp-modal-close" onClick={() => setAchModal(null)}><FiX /></button>
                    </div>
                    <div className="mp-ach-overall-summary">
                        <div className="mp-ach-overall-left">
                            <span className="mp-ach-overall-label">Overall Progress</span>
                            <ProgressBar value={overallProgress} height={8} />
                            <span className="mp-ach-overall-pct">{overallProgress}% complete</span>
                        </div>
                        <div className="mp-ach-overall-right">
                            <span className="mp-ach-overall-count">{completedCount}/{planItemsList.length}</span>
                            <span className="mp-ach-overall-count-label">plans done</span>
                        </div>
                    </div>
                    <div className="mp-ach-items-container">
                        <div className="mp-ach-section-title">
                            <FiFileText /> Plan Achievements
                            <span className="mp-ach-section-count">{planItemsList.length} plan{planItemsList.length > 1 ? 's' : ''}</span>
                        </div>
                        {planItemsList.map((planText, idx) => {
                            const item = achItems[idx] || { achievementDetails: '', progress: 0 };
                            const safeProgress = Math.min(100, item.progress || 0);
                            const tk = getProgressTokens(safeProgress);
                            return (
                                <div key={idx} className="mp-ach-item-row" style={{ borderLeftColor: tk.borderColor }}>
                                    <div className="mp-ach-item-header">
                                        <CircularProgress progress={safeProgress} size={48} />
                                        <div className="mp-ach-item-plan-info">
                                            <div className="mp-ach-item-plan-num">
                                                {/* <span className="mp-plan-seq-num mp-plan-seq-num--sm">{idx + 1}</span> */}
                                                Plan {idx + 1}
                                            </div>
                                            <div className="mp-ach-item-plan-text">{planText}</div>
                                        </div>
                                        <span className="mp-ach-progress-badge" style={{ background: tk.badgeBg, color: tk.badgeText }}>{tk.label}</span>
                                    </div>
                                    <div className="mp-ach-progress-controls">
                                        <label className="mp-ach-ctrl-label">Progress</label>
                                        <div className="mp-ach-slider-wrap">
                                            <div className="mp-ach-slider-track-bg">
                                                <div className="mp-ach-slider-fill" style={{ width: `${safeProgress}%`, background: tk.barColor }} />
                                                <input type="range" min={0} max={100} step={5}
                                                    value={safeProgress}
                                                    onChange={e => updateAchItem(idx, 'progress', parseInt(e.target.value))}
                                                    className="mp-ach-range"
                                                    style={{ '--thumb-color': tk.ringColor }}
                                                />
                                            </div>
                                            <span className="mp-ach-slider-pct" style={{ color: tk.ringColor }}>{safeProgress}%</span>
                                        </div>
                                        <div className="mp-ach-progress-btns">
                                            {[0, 25, 50, 75, 100].map(v => (
                                                <button key={v} type="button"
                                                    className={`mp-ach-prog-btn${safeProgress === v ? ' active' : ''}`}
                                                    style={safeProgress === v ? { background: tk.barColor, borderColor: tk.barColor } : {}}
                                                    onClick={() => updateAchItem(idx, 'progress', v)}>
                                                    {v === 100 ? '✓ Done' : `${v}%`}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="mp-ach-item-textarea-wrap">
                                        <label className="mp-ach-ctrl-label">ACHIEVEMENT DETAILS</label>
                                        <textarea
                                            className={`mp-ach-item-textarea${item.achievementDetails ? ' filled' : ''}`}
                                            value={item.achievementDetails}
                                            onChange={e => updateAchItem(idx, 'achievementDetails', e.target.value)}
                                            placeholder={`Describe what you achieved for Plan ${idx + 1}...`}
                                            rows={3}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                        <div className="mp-ach-additional-section">
                            <div className="mp-ach-additional-header">
                                <span className="mp-ach-additional-icon"><FiStar /></span>
                                <span className="mp-ach-additional-title">Additional Achievements</span>
                                <span className="mp-ach-additional-badge">Optional</span>
                            </div>
                            <p className="mp-ach-additional-hint">Achievements outside your planned work. Click <strong>+</strong> to add more.</p>
                            <div className="mp-plan-boxes">
                                {additionalAchItems.map((item, idx) => renderAdditionalBox(item, idx))}
                            </div>
                        </div>
                    </div>
                    <div className="mp-ach-actions">
                        <button className="btn btn-primary" disabled={submitting} onClick={() => handleAchSubmit(false)}>
                            <FiSend /> {submitting ? 'Submitting...' : 'Submit Achievement'}
                        </button>
                        <button className="btn btn-secondary" disabled={submitting} onClick={() => handleAchSubmit(true)}>
                            <FiSave /> Save as Draft
                        </button>
                        <button className="btn btn-secondary" onClick={() => setAchModal(null)}>Cancel</button>
                    </div>
                </div>
            </div>,
            document.body
        );
    };

    /* ======================================================
       DETAIL MODAL — redesigned header with month chip + stepper below
    ====================================================== */
    const renderDetailModal = () => {
        if (!selectedPlan) return null;

        const ach = achievementByPlanId[selectedPlan._id];
        const ev = evaluationByMonth[selectedPlan.month];
        const isEval = ev && ev.status === 'EVALUATED';
        const prog = getProgress(selectedPlan);
        const planItemsList = getPlanItems(selectedPlan);
        const chipStyle = getMonthChipStyle(selectedPlan.month);

        const effectivePlanAch = getEffectivePlanAch(ach, planItemsList.length);
        const hasStructuredAch = !!effectivePlanAch;
        const achIsSubmitted = ach && ach.status !== 'DRAFT';

        let additionalItems = parseAdditionalAch(ach?.additionalAchievement || '');
        if (additionalItems.length === 0 && ach?.achievementDetails) {
            const addlMatch = ach.achievementDetails.match(/Additional:\s*([\s\S]+)/i);
            if (addlMatch) {
                const captured = addlMatch[1].trim();
                try {
                    const parsed = JSON.parse(captured);
                    additionalItems = Array.isArray(parsed) ? parsed.filter(a => (a.text || '').trim()) : [{ text: captured, progress: 100 }];
                } catch { additionalItems = [{ text: captured, progress: 100 }]; }
            }
        }

        const achOverall = hasStructuredAch && achIsSubmitted
            ? Math.round(effectivePlanAch.reduce((s, a) => s + Math.min(100, a.progress || 0), 0) / effectivePlanAch.length)
            : null;
        const achCompleted = hasStructuredAch && achIsSubmitted
            ? effectivePlanAch.filter(a => (a.progress || 0) >= 100).length : 0;

        // Stepper states: 'done' | 'active' | 'idle'
        const s1 = prog.planDone ? 'done' : 'active';
        const s2 = prog.achDone ? 'done' : prog.planDone ? 'active' : 'idle';
        const s3 = isEval ? 'done' : prog.achDone ? 'active' : 'idle';

        // Connector fill logic
        const conn1Filled = s1 === 'done';           // Plan → Achievement
        const conn2Filled = s2 === 'done';           // Achievement → Evaluated

        /* Step node renderer */
        const StepNode = ({ state }) => (
            <div className={`dmod-step-circle dmod-step-circle--${state}`}>
                {state === 'done' ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                ) : (
                    <div className="dmod-step-dot-inner" />
                )}
            </div>
        );

        return createPortal(
            <div className="mp-overlay" onClick={() => setSelectedPlan(null)}>
                <div className="dmod" onClick={e => e.stopPropagation()}>

                    {/* ══════════════════════════════════════
                        HEADER — month chip + title + close
                    ══════════════════════════════════════ */}
                    <div className="dmod-hdr">

                        {/* Top row: chip + title/meta + close button */}
                        <div className="dmod-hdr-top">
                            {/* Month chip — same style as cards */}
                            <div className="dmod-month-chip" style={{ background: chipStyle.bg, color: chipStyle.color }}>
                                <span className="dmod-month-chip-mon">{shortMonth(selectedPlan.month)}</span>
                                <span className="dmod-month-chip-yr">{shortYear(selectedPlan.month)}</span>
                            </div>

                            {/* Title & meta */}
                            <div className="dmod-hdr-info">
                                <h2 className="dmod-title">{formatMonth(selectedPlan.month)}</h2>
                                <div className="dmod-meta">
                                    <FiClock size={11} />
                                    <span>Submitted {formatDate(selectedPlan.submittedAt)}</span>
                                    <span className="dmod-meta-dot" />
                                    <span>{planItemsList.length} Plan{planItemsList.length !== 1 ? 's' : ''}</span>
                                    <span className="dmod-meta-dot" />
                                    <span className={`dmod-status-pill ${isEval ? 'dmod-sp-eval' : prog.achDone ? 'dmod-sp-ach' : 'dmod-sp-plan'}`}>
                                        {isEval ? 'Evaluated' : prog.achDone ? 'Achievement Submitted' : 'Plan Submitted'}
                                    </span>
                                </div>
                            </div>

                            {/* Close button — top right */}
                            <button className="dmod-close" onClick={() => setSelectedPlan(null)}>
                                <FiX size={14} />
                            </button>
                        </div>

                        {/* ── STEPPER — full-width below header ── */}
                        <div className="dmod-stepper">
                            <div className="dmod-step">
                                <StepNode state={s1} />
                                <span className={`dmod-step-lbl dmod-step-lbl--${s1}`}>Plan</span>
                            </div>

                            <div className={`dmod-connector ${conn1Filled ? 'dmod-connector--filled' : ''}`} />

                            <div className="dmod-step">
                                <StepNode state={s2} />
                                <span className={`dmod-step-lbl dmod-step-lbl--${s2}`}>Achievement</span>
                            </div>

                            <div className={`dmod-connector ${conn2Filled ? 'dmod-connector--filled' : ''}`} />

                            <div className="dmod-step">
                                <StepNode state={s3} />
                                <span className={`dmod-step-lbl dmod-step-lbl--${s3}`}>Evaluated</span>
                            </div>
                        </div>

                    </div>

                    {/* ── BODY ── */}
                    <div className="dmod-body">

                        {/* Overview cards */}
                        {achIsSubmitted && achOverall !== null && (
                            <div className="dmod-overview">
                                <div className="dmod-ov-card">
                                    <p className="dmod-ov-label">Plans Completed</p>
                                    <p className="dmod-ov-value">
                                        {achCompleted}
                                        <span className="dmod-ov-denom"> / {effectivePlanAch.length}</span>
                                    </p>
                                    <div className="dmod-ov-bar">
                                        <div className="dmod-ov-fill" style={{
                                            width: `${(achCompleted / effectivePlanAch.length) * 100}%`,
                                            background: achCompleted === effectivePlanAch.length ? '#16A34A' : '#F59E0B'
                                        }} />
                                    </div>
                                    <p className="dmod-ov-sub-note">Submitted {formatDate(selectedPlan.submittedAt)}</p>
                                </div>
                                <div className="dmod-ov-card">
                                    <p className="dmod-ov-label">Overall Achievement</p>
                                    <div className="dmod-ov-ach-row">
                                        <div>
                                            <p className="dmod-ov-pct" style={{ color: achOverall >= 70 ? '#16A34A' : achOverall >= 40 ? '#D97706' : '#94A3B8' }}>
                                                {achOverall}%
                                            </p>
                                            <p className="dmod-ov-sub-note">Submitted {formatDate(ach?.submittedAt)}</p>
                                        </div>
                                        <DonutChart value={achOverall} size={68} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Plans & Achievements */}
                        <div className="dmod-section">
                            <div className="dmod-sec-hdr">
                                <span className="dmod-sec-title"><FiFileText size={13} style={{ marginRight: 6 }} />Plans &amp; Achievements</span>
                                <span className="dmod-sec-badge">{planItemsList.length} plan{planItemsList.length !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="dmod-plan-cards">
                                {planItemsList.map((planText, i) => {
                                    const pa = hasStructuredAch && achIsSubmitted
                                        ? (effectivePlanAch[i] || { achievementDetails: '', progress: 0 })
                                        : { achievementDetails: '', progress: 0 };
                                    const p = Math.min(100, pa.progress || 0);
                                    const statusLabel = p === 100 ? 'Completed' : p > 0 ? 'In Progress' : 'Not Started';
                                    const statusCls = p === 100 ? 'dmod-badge--green' : p > 0 ? 'dmod-badge--amber' : 'dmod-badge--gray';
                                    const barColor = p === 100 ? '#16A34A' : p > 0 ? '#F59E0B' : '#E2E8F0';
                                    return (
                                        <div key={i} className="dmod-plan-card">
                                            <div className="dmod-plan-card-top">
                                                <span className="dmod-plan-num">{i + 1}</span>
                                                <div className="dmod-plan-card-info">
                                                    <div className="dmod-plan-card-title-row">
                                                        <span className="dmod-plan-name">{planText}</span>
                                                        {achIsSubmitted && <span className={`dmod-badge ${statusCls}`}>{statusLabel}</span>}
                                                    </div>
                                                    {achIsSubmitted && (
                                                        pa.achievementDetails
                                                            ? <p className="dmod-plan-ach-text">{pa.achievementDetails}</p>
                                                            : <p className="dmod-plan-ach-empty">No achievement details</p>
                                                    )}
                                                </div>
                                            </div>
                                            {achIsSubmitted && (
                                                <div className="dmod-plan-prog-row">
                                                    <div className="dmod-plan-prog-bar">
                                                        <div className="dmod-plan-prog-fill" style={{ width: `${p}%`, background: barColor }} />
                                                    </div>
                                                    <span className="dmod-plan-prog-pct" style={{ color: p === 0 ? '#CBD5E1' : barColor }}>{p}%</span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* No achievement */}
                        {(!ach || ach.status === 'DRAFT') && (
                            <div className="dmod-no-ach">
                                <div className="dmod-no-ach-icon-wrap"><FiTrendingUp size={15} /></div>
                                <p>{ach?.status === 'DRAFT' ? 'Achievement draft saved — not yet submitted.' : 'No achievement submitted for this month yet.'}</p>
                            </div>
                        )}

                        {/* Legacy achievement */}
                        {achIsSubmitted && !hasStructuredAch && ach.achievementDetails && (
                            <div className="dmod-section">
                                <div className="dmod-sec-hdr">
                                    <span className="dmod-sec-title"><FiTrendingUp size={13} style={{ marginRight: 6 }} />Achievement Details</span>
                                </div>
                                <p className="dmod-plan-ach-text" style={{ margin: 0 }}>{ach.achievementDetails}</p>
                            </div>
                        )}

                        {/* Additional achievements */}
                        {additionalItems.length > 0 && (
                            <div className="dmod-section">
                                <div className="dmod-sec-hdr">
                                    <span className="dmod-sec-title"><FiStar size={13} style={{ marginRight: 6 }} />Additional Achievements</span>
                                    <span className="dmod-sec-badge">{additionalItems.length} extra</span>
                                </div>
                                <div className="dmod-extra-list">
                                    {additionalItems.map((item, i) => {
                                        const text = typeof item === 'string' ? item : (item.text || '');
                                        const itemProg = typeof item === 'string' ? 100 : Math.min(100, item.progress ?? 100);
                                        const barColor = itemProg === 100 ? '#16A34A' : itemProg > 0 ? '#F59E0B' : '#E2E8F0';
                                        return (
                                            <div key={i} className="dmod-extra-item">
                                                <span className="dmod-extra-num">{i + 1}</span>
                                                <div className="dmod-extra-content">
                                                    <p className="dmod-extra-text">{text}</p>
                                                    <div className="dmod-plan-prog-row" style={{ paddingLeft: 0 }}>
                                                        <div className="dmod-plan-prog-bar">
                                                            <div className="dmod-plan-prog-fill" style={{ width: `${itemProg}%`, background: barColor }} />
                                                        </div>
                                                        <span className="dmod-plan-prog-pct" style={{ color: itemProg === 0 ? '#CBD5E1' : barColor }}>{itemProg}%</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* RA Evaluation */}
                        <div className={`dmod-ra-section ${isEval ? 'dmod-ra-section--done' : ''}`}>
                            {isEval ? (
                                <>
                                    <div className="dmod-ra-hdr">
                                        <div className="dmod-ra-check-icon">
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                                        </div>
                                        <span className="dmod-ra-title-text">Evaluated by Reporting Authority</span>
                                        {ev.evaluatedAt && (
                                            <span className="dmod-ra-date-tag"><FiClock size={10} /> {formatDate(ev.evaluatedAt)}</span>
                                        )}
                                    </div>
                                    {ev.remarks && <blockquote className="dmod-ra-quote">{ev.remarks}</blockquote>}
                                </>
                            ) : (
                                <div className="dmod-ra-pending"><FiClock size={13} /><span>Pending evaluation by Reporting Authority</span></div>
                            )}
                        </div>

                    </div>

                    {/* ── FOOTER ── */}
                    <div className="dmod-footer">
                        <button className="dmod-btn-close" onClick={() => setSelectedPlan(null)}>Close</button>
                    </div>

                </div>
            </div>,
            document.body
        );
    };

    /* ======================================================
       MAIN RENDER
    ====================================================== */
    return (
        <div className="fade-in">
            <div className="page-header">
                <h1>Monthly Plan & Achievement</h1>
                <p>Submit work plans, track achievements, and view RA evaluations — all in one place</p>
            </div>

            {/* Stats */}
            <div className="mp-stats-row">
                <div className="mp-stat">
                    <div className="mp-stat-icon blue"><FiFileText /></div>
                    <div><div className="mp-stat-value">{stats.total}</div><div className="mp-stat-label">Plans</div></div>
                </div>
                <div className="mp-stat">
                    <div className="mp-stat-icon green"><FiTrendingUp /></div>
                    <div><div className="mp-stat-value">{stats.withAch}</div><div className="mp-stat-label">Achievements</div></div>
                </div>
                {stats.drafts > 0 && (
                    <div className="mp-stat">
                        <div className="mp-stat-icon amber"><FiSave /></div>
                        <div><div className="mp-stat-value">{stats.drafts}</div><div className="mp-stat-label">Drafts</div></div>
                    </div>
                )}
                <div className="mp-stat">
                    <div className="mp-stat-icon purple"><FiCheckCircle /></div>
                    <div><div className="mp-stat-value">{stats.evaluated}</div><div className="mp-stat-label">Evaluated</div></div>
                </div>
            </div>

            {/* Actions + Filters */}
            <div className="mp-action-row">
                <button className="btn btn-primary" onClick={() => setShowPlanForm(!showPlanForm)}>
                    <FiPlus /> Submit Monthly Plan
                </button>
                <div className="mp-filters">
                    <div className="mp-filter-group">
                        <FiCalendar />
                        <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))}>
                            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                    <div className="mp-filter-group">
                        <FiSearch />
                        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>
                            <option value="">All Months</option>
                            {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            {/* Submit Plan Form */}
            {showPlanForm && (() => {
                const now = new Date();
                const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                const todayDay = now.getDate();
                const planDeadlinePassed = ENFORCE_DEADLINES && todayDay > 7;

                return (
                    <div className="mp-form-card">
                        <div className="mp-form-header">
                            <h3><FiSend /> Submit Monthly Plan</h3>
                            <button className="mp-form-close" onClick={() => setShowPlanForm(false)}><FiX /></button>
                        </div>
                        <div className="mp-form-step-indicator">
                            <div className="mp-form-step active"><span className="mp-form-step-dot">1</span><span>Submit Monthly Plan</span></div>
                            <FiChevronRight className="mp-form-step-arrow" />
                            <div className="mp-form-step muted"><span className="mp-form-step-dot muted">2</span><span>Submit Achievement</span></div>
                        </div>

                        {planDeadlinePassed ? (
                            /* ── LOCKED BANNER: Deadline passed in production mode ── */
                            <div className="mp-deadline-locked-banner">
                                <div className="mp-deadline-locked-icon"><FiAlertCircle /></div>
                                <div className="mp-deadline-locked-content">
                                    <strong>Submission Window Closed</strong>
                                    <p>
                                        The monthly plan for <strong>{new Date(now.getFullYear(), now.getMonth()).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</strong> can only be submitted between the <strong>1st–7th</strong> of each month.
                                        The deadline has passed.
                                    </p>
                                </div>
                                <button type="button" className="btn btn-secondary" onClick={() => setShowPlanForm(false)}>Close</button>
                            </div>
                        ) : (
                            /* ── ACTIVE FORM ── */
                            <form onSubmit={handleSubmitPlan}>
                                <div className="mp-form-month-row">
                                    <div className="mp-form-group mp-form-group--month">
                                        <label>Month</label>
                                        {ENFORCE_DEADLINES ? (
                                            /* Production: locked to current month, no picker */
                                            <div className="mp-month-locked-display">
                                                <FiCalendar />
                                                <span>{new Date(now.getFullYear(), now.getMonth()).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
                                                <span className="mp-month-locked-badge">Current Month</span>
                                            </div>
                                        ) : (
                                            /* Dev mode: full year + month custom picker */
                                            <div className="mp-dev-month-picker">
                                                <select
                                                    className="mp-dev-year-select"
                                                    value={pickerYear}
                                                    onChange={e => {
                                                        const yr = Number(e.target.value);
                                                        setPickerYear(yr);
                                                        const curMo = planMonth ? planMonth.split('-')[1] : String(now.getMonth() + 1).padStart(2, '0');
                                                        setPlanMonth(`${yr}-${curMo}`);
                                                    }}
                                                >
                                                    {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                                                </select>
                                                <select
                                                    className="mp-dev-month-select"
                                                    value={planMonth ? planMonth.split('-')[1] : ''}
                                                    onChange={e => setPlanMonth(`${pickerYear}-${e.target.value}`)}
                                                    required
                                                >
                                                    <option value="">— Select month —</option>
                                                    {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                                </select>
                                                {/* <span className="mp-dev-mode-badge">DEV MODE</span> */}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="mp-form-hint">
                                    <FiPlus className="mp-form-hint-icon" />
                                    Write each work plan in its own box. Click the <strong>+</strong> button beside any box to add another plan below it.
                                </div>
                                <div className="mp-form-group">
                                    <label>
                                        Plan Details
                                        <span className="mp-form-plan-count">{planItems.filter(p => p.trim()).length} plan{planItems.filter(p => p.trim()).length !== 1 ? 's' : ''}</span>
                                    </label>
                                    <div className="mp-plan-boxes">
                                        {planItems.map((item, i) => renderPlanBox(item, i, planItems, updatePlanItem, addPlanItem, removePlanItem))}
                                    </div>
                                </div>
                                <div className="mp-form-actions">
                                    <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Submitting...' : 'Submit Plan'}</button>
                                    <button type="button" className="btn btn-secondary"
                                        disabled={submitting || !planMonth || !planItems.some(p => p.trim())}
                                        onClick={() => handleSubmitPlan(null, true)}>
                                        <FiSave /> Save as Draft
                                    </button>
                                    <button type="button" className="btn btn-secondary" onClick={() => setShowPlanForm(false)}>Cancel</button>
                                </div>
                            </form>
                        )}
                    </div>
                );
            })()}

            {/* Cards */}
            {filteredPlans.length === 0 ? (
                <div className="mp-empty">
                    <div className="mp-empty-icon"><FiCalendar /></div>
                    <h3>No Plans Found</h3>
                    <p>{filterMonth ? `No plans for ${months.find(m => m.value === filterMonth)?.label} ${filterYear}` : `No plans for ${filterYear}`}. Submit your first plan to get started.</p>
                </div>
            ) : (
                <div className="mp-unified-grid">
                    {filteredPlans.map(plan => {
                        const ach = achievementByPlanId[plan._id];
                        const ev = evaluationByMonth[plan.month];
                        const isEval = ev && ev.status === 'EVALUATED';
                        const st = getStatusInfo(plan);
                        const isDraftAch = ach?.status === 'DRAFT';
                        const isPlanDraft = plan.status === 'DRAFT';
                        const isRejected = plan.status === 'REJECTED';
                        const planItemsList = getPlanItems(plan);
                        const chipStyle = getMonthChipStyle(plan.month);
                        const effectivePlanAch = ach && !isDraftAch ? getEffectivePlanAch(ach, planItemsList.length) : null;
                        const achOverall = effectivePlanAch ? Math.round(effectivePlanAch.reduce((s, a) => s + Math.min(100, a.progress || 0), 0) / effectivePlanAch.length) : null;
                        const achCompleted = effectivePlanAch ? effectivePlanAch.filter(a => (a.progress || 0) >= 100).length : 0;

                        return (
                            <div key={plan._id} className={`mp-unified-card status-${st.cls}`}>
                                <div className="mp-unified-header">
                                    <div className="mp-month-chip-card" style={{ background: chipStyle.bg, color: chipStyle.color }}>
                                        <span className="mp-month-chip-mon">{shortMonth(plan.month)}</span>
                                        <span className="mp-month-chip-yr">{shortYear(plan.month)}</span>
                                    </div>
                                    <div className="mp-month-full">{formatMonth(plan.month)}</div>
                                    <span className={`mp-status-badge ${st.cls}`}>{st.label}</span>
                                </div>
                                {isPlanDraft && (
                                    <div className="mp-draft-banner">
                                        <div className="mp-rejection-header"><FiSave /><strong>Draft — Not Yet Submitted</strong></div>
                                        <button className="mp-resubmit-btn" style={{ background: '#3B82F6' }} onClick={e => { e.stopPropagation(); openResubmitModal(plan); }}>
                                            <FiEdit3 /> Edit & Submit
                                        </button>
                                    </div>
                                )}
                                {isRejected && (
                                    <div className="mp-rejection-banner">
                                        <div className="mp-rejection-header"><FiAlertCircle /><strong>Rejected by MD</strong></div>
                                        {plan.mdRemarks && <div className="mp-rejection-remarks">"{plan.mdRemarks}"</div>}
                                        <button className="mp-resubmit-btn" onClick={e => { e.stopPropagation(); openResubmitModal(plan); }}>
                                            <FiRefreshCw /> Resubmit Plan
                                        </button>
                                    </div>
                                )}
                                <div className="mp-section plan">
                                    <div className="mp-section-label">
                                        <FiFileText /> Plan
                                        <span className="mp-section-plan-count-pill">{planItemsList.length} plan{planItemsList.length !== 1 ? 's' : ''}</span>
                                    </div>
                                    <div className="mp-card-plan-list">
                                        {planItemsList.slice(0, 3).map((p, i) => (
                                            <div key={i} className="mp-card-plan-item">
                                                <span className="mp-plan-idx-xs">{i + 1}</span>
                                                <span className="mp-card-plan-text">{p}</span>
                                            </div>
                                        ))}
                                        {planItemsList.length > 3 && (
                                            <div className="mp-card-plan-more">+{planItemsList.length - 3} more plan{planItemsList.length - 3 > 1 ? 's' : ''}</div>
                                        )}
                                    </div>
                                    <div className="mp-section-date"><FiClock size={10} /> Submitted {formatDateShort(plan.submittedAt)}</div>
                                </div>
                                <div className={`mp-section achievement ${ach && !isDraftAch ? 'filled' : 'empty'}`}>
                                    <div className="mp-section-label"><FiTrendingUp /> Achievement</div>
                                    {ach && !isDraftAch ? (
                                        <>
                                            {effectivePlanAch ? (
                                                <div className="mp-card-ach-summary">
                                                    <div className="mp-card-ach-bar-wrap">
                                                        <ProgressBar value={achOverall} height={7} />
                                                        <span className="mp-card-ach-overall-pct">{achOverall}%</span>
                                                    </div>
                                                    <span className="mp-card-ach-summary-text">{achCompleted}/{effectivePlanAch.length} completed · {achOverall}% overall</span>
                                                </div>
                                            ) : (
                                                <div className="mp-section-text">{ach.achievementDetails}</div>
                                            )}
                                            <div className="mp-section-date"><FiClock size={10} /> Submitted {formatDateShort(ach.submittedAt)}</div>
                                        </>
                                    ) : isDraftAch ? (
                                        <div className="mp-draft-inline">
                                            <div className="mp-draft-badge-sm"><FiSave /> Draft saved</div>
                                            <button className="mp-add-ach-btn" onClick={() => openAchModal(plan)}><FiEdit3 /> Continue Editing</button>
                                        </div>
                                    ) : isPlanDraft ? (
                                        <div className="mp-ach-locked"><FiAlertCircle className="mp-ach-locked-icon" /><span>Submit your plan first to unlock achievement entry</span></div>
                                    ) : isRejected ? (
                                        <div className="mp-ach-locked"><FiAlertCircle className="mp-ach-locked-icon" /><span>Resubmit your plan to unlock achievement entry</span></div>
                                    ) : (
                                        <button className="mp-add-ach-btn" onClick={() => openAchModal(plan)}><FiPlus /> Add Achievement</button>
                                    )}
                                </div>
                                {isEval && (
                                    <div className="mp-eval-strip">
                                        <FiCheckCircle />
                                        <span>Evaluated by RA</span>
                                        {ev.score != null && <span className="mp-eval-strip-score">{ev.score}/10</span>}
                                    </div>
                                )}
                                <button className="mp-detail-btn" onClick={() => setSelectedPlan(plan)}>View Details <FiChevronRight /></button>
                            </div>
                        );
                    })}
                </div>
            )}

            {renderAchModal()}
            {renderDetailModal()}

            {resubmitPlan && createPortal(
                <div className="mp-overlay" onClick={() => setResubmitPlan(null)}>
                    <div className="mp-ach-modal mp-ach-modal--wide" onClick={e => e.stopPropagation()}>
                        <div className="mp-ach-modal-header">
                            <div>
                                <h2>{resubmitPlan.status === 'DRAFT' ? 'Edit & Submit Plan' : 'Resubmit Plan'} — {formatMonth(resubmitPlan.month)}</h2>
                                <p className="mp-ach-subtitle">{resubmitPlan.status === 'DRAFT' ? 'Finalise your draft and submit.' : 'MD rejected your previous plan. Update and resubmit below.'}</p>
                            </div>
                            <button className="mp-modal-close" onClick={() => setResubmitPlan(null)}><FiX /></button>
                        </div>
                        <div className="mp-ach-items-container">
                            {resubmitPlan.mdRemarks && (
                                <div className="mp-resubmit-remarks-box">
                                    <div className="mp-resubmit-remarks-label">MD Remarks</div>
                                    <div className="mp-resubmit-remarks-text">{resubmitPlan.mdRemarks}</div>
                                </div>
                            )}
                            <div className="mp-form-hint" style={{ margin: 0 }}>
                                <FiPlus className="mp-form-hint-icon" />
                                Write each plan in its own box. Click <strong>+</strong> to add another plan below it.
                            </div>
                            <div>
                                <div className="mp-ach-section-title">
                                    <FiFileText /> Updated Plan Details
                                    <span className="mp-ach-section-count">{resubmitItems.filter(p => p.trim()).length} plan{resubmitItems.filter(p => p.trim()).length !== 1 ? 's' : ''}</span>
                                </div>
                                <div className="mp-plan-boxes" style={{ marginTop: 10 }}>
                                    {resubmitItems.map((item, i) => renderPlanBox(item, i, resubmitItems, updateResubmitItem, addResubmitItem, removeResubmitItem))}
                                </div>
                            </div>
                        </div>
                        <div className="mp-ach-actions">
                            <button className="btn btn-primary"
                                disabled={submitting || !resubmitItems.some(p => p.trim())}
                                onClick={() => handleResubmitPlan(false)}>
                                <FiSend /> {submitting ? 'Submitting...' : (resubmitPlan.status === 'DRAFT' ? 'Submit Plan' : 'Resubmit Plan')}
                            </button>
                            {resubmitPlan.status === 'DRAFT' && (
                                <button className="btn btn-secondary" disabled={submitting || !resubmitItems.some(p => p.trim())} onClick={() => handleResubmitPlan(true)}>
                                    <FiSave /> Save as Draft
                                </button>
                            )}
                            <button className="btn btn-secondary" onClick={() => setResubmitPlan(null)}>Cancel</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default MonthlyPlanPage;