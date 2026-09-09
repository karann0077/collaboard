import React from 'react';

const TOOLS = [
  ['pen',    '✏️ Pen'],
  ['rect',   '▭ Rectangle'],
  ['circle', '◯ Circle'],
  ['line',   '╱ Line'],
  ['arrow',  '→ Arrow'],
  ['text',   'T Text'],
  ['eraser', '🧽 Eraser'],
];

/**
 * Toolbar — drawing tool selector and stroke options.
 *
 * Bug #10 fix: accepts `disabled` prop. When true (viewer role), all interactive
 * controls are non-clickable and styled as read-only to match server-side enforcement.
 */
export function Toolbar({ tool, setTool, color, setColor, width, setWidth, style, setStyle, disabled }) {
  return (
    <aside className={`toolbar${disabled ? ' toolbar--disabled' : ''}`}>
      {disabled && (
        <div className="viewer-badge">👁 View Only</div>
      )}

      {TOOLS.map(([id, label]) => (
        <div
          key={id}
          className={'tool' + (tool === id ? ' selected' : '') + (disabled ? ' tool--disabled' : '')}
          onClick={disabled ? undefined : () => setTool(id)}
          title={disabled ? 'Viewers cannot edit the board' : label}
          role="button"
          aria-disabled={disabled}
        >
          {label}
        </div>
      ))}

      <hr />

      <div className="control">
        <label>Color</label>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="control">
        <label>Width: {width}px</label>
        <input
          type="range"
          min="1"
          max="20"
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
          disabled={disabled}
        />
      </div>

      <div className="control">
        <label>Style</label>
        <select
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          disabled={disabled}
        >
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </div>
    </aside>
  );
}
