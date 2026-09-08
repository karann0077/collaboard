import React from 'react';

const TOOLS = [
  ['pen', '✏️ Pen'],
  ['rect', '▭ Rectangle'],
  ['circle', '◯ Circle'],
  ['line', '╱ Line'],
  ['arrow', '→ Arrow'],
  ['text', 'T Text'],
  ['eraser', '🧽 Eraser']
];

export function Toolbar({ tool, setTool, color, setColor, width, setWidth, style, setStyle }) {
  return (
    <aside className="toolbar">
      {TOOLS.map(([id, label]) => (
        <div key={id} className={'tool' + (tool === id ? ' selected' : '')} onClick={() => setTool(id)}>
          {label}
        </div>
      ))}
      <hr />
      <div className="control">
        <label>Color</label>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </div>
      <div className="control">
        <label>Width: {width}px</label>
        <input type="range" min="1" max="20" value={width} onChange={(e) => setWidth(Number(e.target.value))} />
      </div>
      <div className="control">
        <label>Style</label>
        <select value={style} onChange={(e) => setStyle(e.target.value)}>
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </div>
    </aside>
  );
}
