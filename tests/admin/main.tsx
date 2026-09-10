import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminPreview } from './preview';
import './preview.css';
const root = createRoot(document.getElementById('root')!);
fetch('/fixture.json').then(r => { if (!r.ok) throw new Error('Fixture unavailable'); return r.json(); }).then(data => root.render(<AdminPreview initial={data} />)).catch(() => root.render(<p role="alert">预览数据无法读取，请重新运行 pnpm admin:preview。</p>));
