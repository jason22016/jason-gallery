import { createRoot } from 'react-dom/client';
import { AdminPreview } from './gallery';
import { request, RequestError } from './api';
import './gallery.css';
const root = createRoot(document.getElementById('root')!);
root.render(<div className="admin"><main><h1>正在验证管理会话…</h1></main></div>);
request('/api/state').then(data => root.render(<AdminPreview initial={{ sources: data.sources, projects: data.projects, photos: data.media.photos, imageMode: '已验证照片产物' }} management={data} />)).catch(error => root.render(<div className="admin"><main><h1>管理后台暂不可用</h1><p role="alert">{error.message}</p>{error instanceof RequestError && error.status === 401 ? <><a href="/">通过 Cloudflare Access 登录</a><p>管理会话已过期或身份验证失败，请重新登录。</p></> : <p>请稍后重试；若持续失败，请检查后台服务状态。</p>}<button onClick={() => location.reload()}>重试</button></main></div>));
