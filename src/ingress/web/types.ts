export const DASHBOARD_PAGES = {
  '/': { id: 'home', title: '运行概览', description: '查看网关状态并进入各管理模块。', icon: 'activity' },
  '/usage': { id: 'usage', title: '使用统计', description: '按日期查看请求量、成功率和 Token 用量。', icon: 'chart' },
  '/requests': { id: 'requests', title: '请求日志', description: '筛选请求并查看关联的完整日志事件。', icon: 'log' },
  '/google-accounts': { id: 'google-accounts', title: 'Google 账号池', description: '管理 Antigravity 账号、调度策略和账号授权。', icon: 'users' },
  '/codex': { id: 'codex', title: 'Codex 账号与额度', description: '查看登录状态、执行连接检查并刷新订阅额度。', icon: 'key' },
  '/models': { id: 'models', title: '模型管理', description: '搜索模型、运行连通性检查并管理推理档位。', icon: 'box' },
  '/playground': { id: 'playground', title: '推理测试台', description: '直接向选定模型发送一条测试请求。', icon: 'zap' },
  '/connect': { id: 'connect', title: '客户端接入', description: '查看 Claude Code、Cursor、Cline 和 Aider 的连接配置。', icon: 'plug' }
} as const;

export type DashboardPage = typeof DASHBOARD_PAGES[keyof typeof DASHBOARD_PAGES]['id'];

export interface DashboardRoute {
  id: DashboardPage;
  title: string;
  description: string;
  icon: string;
}

export const DASHBOARD_PAGE_ROUTES: Record<string, DashboardRoute> = DASHBOARD_PAGES;
