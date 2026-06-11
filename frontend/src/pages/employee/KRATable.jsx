import { FiTrash2, FiPlusCircle } from 'react-icons/fi';

/**
 * KRATable — reusable KRA table component.
 *
 * Props:
 *   rows       — array of { description, target, timeline }
 *   onChange   — (updatedRows) => void  (omit for readOnly mode)
 *   readOnly   — boolean; when true renders as a display table
 */
const KRATable = ({ rows = [], onChange, readOnly = false }) => {
    const addRow = () => {
        onChange([...rows, { description: '', target: '', timeline: '' }]);
    };

    const updateRow = (index, field, value) => {
        const updated = rows.map((row, i) =>
            i === index ? { ...row, [field]: value } : row
        );
        onChange(updated);
    };

    const deleteRow = (index) => {
        if (rows.length <= 1) return;
        onChange(rows.filter((_, i) => i !== index));
    };

    if (readOnly) {
        return (
            <div className="yp-kra-table-wrap">
                {rows.length === 0 ? (
                    <p className="yp-kra-empty">No KRAs recorded for this plan.</p>
                ) : (
                    <table className="yp-kra-table yp-kra-table--readonly">
                        <thead>
                            <tr>
                                <th className="yp-kra-th yp-kra-th--num">#</th>
                                <th className="yp-kra-th">KRA Description</th>
                                <th className="yp-kra-th">Target / Measurable Outcome</th>
                                <th className="yp-kra-th">Timeline / Milestone</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, index) => (
                                <tr key={index} className="yp-kra-tr">
                                    <td className="yp-kra-td yp-kra-td--num">{index + 1}</td>
                                    <td className="yp-kra-td">{row.description || '—'}</td>
                                    <td className="yp-kra-td">{row.target || '—'}</td>
                                    <td className="yp-kra-td">{row.timeline || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        );
    }

    // Edit mode
    return (
        <div className="yp-kra-table-wrap">
            <table className="yp-kra-table yp-kra-table--edit">
                <thead>
                    <tr>
                        <th className="yp-kra-th yp-kra-th--num">#</th>
                        <th className="yp-kra-th">KRA Description <span className="required">*</span></th>
                        <th className="yp-kra-th">Target / Measurable Outcome <span className="required">*</span></th>
                        <th className="yp-kra-th">Timeline / Milestone <span className="required">*</span></th>
                        <th className="yp-kra-th yp-kra-th--action"></th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={index} className="yp-kra-tr">
                            <td className="yp-kra-td yp-kra-td--num">{index + 1}</td>
                            <td className="yp-kra-td">
                                <input
                                    type="text"
                                    className="yp-kra-input"
                                    placeholder="e.g. Improve project delivery"
                                    value={row.description}
                                    onChange={e => updateRow(index, 'description', e.target.value)}
                                    required
                                />
                            </td>
                            <td className="yp-kra-td">
                                <input
                                    type="text"
                                    className="yp-kra-input"
                                    placeholder="e.g. 95% on-time delivery rate"
                                    value={row.target}
                                    onChange={e => updateRow(index, 'target', e.target.value)}
                                    required
                                />
                            </td>
                            <td className="yp-kra-td">
                                <input
                                    type="text"
                                    className="yp-kra-input"
                                    placeholder="e.g. Q2 2025"
                                    value={row.timeline}
                                    onChange={e => updateRow(index, 'timeline', e.target.value)}
                                    required
                                />
                            </td>
                            <td className="yp-kra-td yp-kra-td--action">
                                <button
                                    type="button"
                                    className="yp-kra-trash-btn"
                                    onClick={() => deleteRow(index)}
                                    disabled={rows.length <= 1}
                                    aria-label="Delete KRA row"
                                    title={rows.length <= 1 ? 'At least one KRA is required' : 'Remove this KRA'}
                                >
                                    <FiTrash2 />
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <button type="button" className="yp-kra-add-btn" onClick={addRow}>
                <FiPlusCircle />
                Add KRA
            </button>
        </div>
    );
};

export default KRATable;
