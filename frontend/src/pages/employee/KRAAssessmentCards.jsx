import { FiCalendar, FiCheckCircle, FiTarget } from 'react-icons/fi';

/**
 * KRAAssessmentCards
 *
 * Renders one achievement card per KRA from the linked yearly plan.
 * Used in two contexts:
 *   1. Submit Appraisal modal  — editable textareas, live progress bar
 *   2. Accordion expanded view — read-only display of submitted achievements
 *
 * Props:
 *   kras      — Array of { description, target, timeline } (from the linked plan)
 *   values    — Object keyed by 0-based index: { [index]: achievementText }
 *   onChange  — (index: number, text: string) => void   (omit in readOnly mode)
 *   readOnly  — boolean; when true, renders plain text instead of textareas
 */
const KRAAssessmentCards = ({ kras = [], values = {}, onChange, readOnly = false }) => {
    const totalKras   = kras.length;
    const filledCount = kras.filter((_, i) => String(values[i] || '').trim().length > 0).length;
    const progressPct = totalKras > 0 ? Math.round((filledCount / totalKras) * 100) : 0;

    if (totalKras === 0) {
        return (
            <p className="kra-ac-no-kras">
                No KRAs are linked to this plan. You may still describe your work in the Additional Assignments field below.
            </p>
        );
    }

    return (
        <div className="kra-ac-wrap">
            {/* ── Progress bar (edit mode only) ─────────────────────────────── */}
            {!readOnly && (
                <div className="kra-ac-progress-row">
                    <span className="kra-ac-progress-label">
                        {totalKras} KRA{totalKras !== 1 ? 's' : ''} to assess
                    </span>
                    <div className="kra-ac-progress-right">
                        <div className="kra-ac-progress-track" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
                            <div className="kra-ac-progress-fill" style={{ width: `${progressPct}%` }} />
                        </div>
                        <span className="kra-ac-progress-count">
                            <FiCheckCircle className={filledCount === totalKras ? 'kra-ac-progress-icon--done' : 'kra-ac-progress-icon'} />
                            {filledCount} / {totalKras} filled
                        </span>
                    </div>
                </div>
            )}

            {/* ── Cards ─────────────────────────────────────────────────────── */}
            <div className="kra-ac-list">
                {kras.map((kra, index) => {
                    const achievement = String(values[index] || '');
                    const isFilled    = achievement.trim().length > 0;

                    return (
                        <div
                            key={index}
                            className={[
                                'kra-ac-card',
                                isFilled  ? 'kra-ac-card--filled'   : '',
                                readOnly  ? 'kra-ac-card--readonly'  : '',
                            ].filter(Boolean).join(' ')}
                        >
                            {/* ── Card header (always read-only) ──────────────── */}
                            <div className="kra-ac-header">
                                <div className="kra-ac-header-top">
                                    <span className="kra-ac-num-badge" aria-label={`KRA ${index + 1}`}>
                                        {index + 1}
                                    </span>
                                    <span className="kra-ac-description">{kra.description || '—'}</span>
                                    {!readOnly && (
                                        <span
                                            className={`kra-ac-fill-badge${isFilled ? ' kra-ac-fill-badge--done' : ''}`}
                                            aria-live="polite"
                                        >
                                            {isFilled ? '✓ Filled' : 'Empty'}
                                        </span>
                                    )}
                                </div>

                                <div className="kra-ac-meta-pills">
                                    <span className="kra-ac-pill kra-ac-pill--target">
                                        <FiTarget aria-hidden="true" />
                                        <span>{kra.target || '—'}</span>
                                    </span>
                                    <span className="kra-ac-pill kra-ac-pill--timeline">
                                        <FiCalendar aria-hidden="true" />
                                        <span>{kra.timeline || '—'}</span>
                                    </span>
                                </div>
                            </div>

                            {/* ── Card body ───────────────────────────────────── */}
                            <div className="kra-ac-body">
                                {readOnly ? (
                                    /* Read-only: plain text block */
                                    <div className="kra-ac-achievement-text">
                                        {achievement.trim() ? achievement : (
                                            <span className="kra-ac-achievement-empty">
                                                No achievement recorded for this KRA.
                                            </span>
                                        )}
                                    </div>
                                ) : (
                                    /* Edit mode: textarea */
                                    <>
                                        <label className="kra-ac-textarea-label" htmlFor={`kra-achievement-${index}`}>
                                            Achievement / progress <span className="required" aria-hidden="true">*</span>
                                        </label>
                                        <textarea
                                            id={`kra-achievement-${index}`}
                                            className="kra-ac-textarea"
                                            placeholder={
                                                !isFilled
                                                    ? 'What did you deliver against this KRA? Mention specific outcomes, numbers, or milestones achieved.'
                                                    : ''
                                            }
                                            value={achievement}
                                            onChange={e => onChange(index, e.target.value)}
                                            aria-required="true"
                                        />
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default KRAAssessmentCards;
