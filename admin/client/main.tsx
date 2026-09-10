import { createRoot } from 'react-dom/client';
import { AdminPreview } from './gallery';
import { request } from './api';
import './gallery.css';
const root = createRoot(document.getElementById('root')!);
root.render(<div className="admin dark"><main><h1>正在验证管理会话…</h1></main></div>);
request('/api/state').then(data => root.render(<AdminPreview initial={{ sources: data.sources, projects: data.projects, photos: data.media.photos, imageMode: '已验证照片产物' }} management={data} />)).catch(error => root.render(<div className="admin dark"><main><h1>管理后台暂不可用</h1><p role="alert">{error.message}</p><a href="/">通过 Cloudflare Access 登录</a><p>请重新登录；若持续失败，请检查后台服务配置。</p><button onClick={() => location.reload()}>重试</button></main></div>));
