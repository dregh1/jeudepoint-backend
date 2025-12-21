// src/utils/gameUtils.js

exports.sanitizeConfig = (c = {}) => {
    let cols = Number(c.cols), rows = Number(c.rows);
    if (!Number.isFinite(cols) || cols < 2) cols = DEFAULT_CONFIG.cols;
    if (!Number.isFinite(rows) || rows < 2) rows = DEFAULT_CONFIG.rows;
    cols = Math.min(Math.max(2, Math.floor(cols)), 50);
    rows = Math.min(Math.max(2, Math.floor(rows)), 50);
    return { cols, rows };
};

exports.normalizeCode = (v) => String(v ?? '').trim();