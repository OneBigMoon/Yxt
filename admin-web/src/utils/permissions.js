export const ROLE_LABELS = {
  super_admin: '超级管理员',
  manager: '门店管理员',
  viewer: '查看员'
}

export const ROLE_OPTIONS = [
  { value: 'super_admin', label: ROLE_LABELS.super_admin },
  { value: 'manager', label: ROLE_LABELS.manager },
  { value: 'viewer', label: ROLE_LABELS.viewer }
]

const ROUTE_ROLE_MAP = {
  '/': ['super_admin', 'manager', 'viewer'],
  '/appointments': ['super_admin', 'manager', 'viewer'],
  '/customers': ['super_admin', 'manager', 'viewer'],
  '/commissions': ['super_admin', 'manager', 'viewer'],
  '/articles': ['super_admin', 'manager'],
  '/services': ['super_admin', 'manager'],
  '/technicians': ['super_admin', 'manager'],
  '/rest-management': ['super_admin', 'manager'],
  '/business-config': ['super_admin', 'manager'],
  '/admin-users': ['super_admin']
}

export function getAdminInfo() {
  const raw = sessionStorage.getItem('admin_info')
  if (!raw) {
    return {}
  }

  try {
    return JSON.parse(raw) || {}
  } catch {
    return {}
  }
}

export function setAdminInfo(info = {}) {
  sessionStorage.setItem('admin_info', JSON.stringify(info))
}

export function clearAdminInfo() {
  sessionStorage.removeItem('admin_info')
}

export function getAdminRole() {
  return getAdminInfo().role || 'super_admin'
}

export function getRoleLabel(role) {
  return ROLE_LABELS[role] || ROLE_LABELS.manager
}

export function hasRoutePermission(path, role = getAdminRole()) {
  const allowedRoles = ROUTE_ROLE_MAP[path] || ['super_admin']
  return allowedRoles.includes(role)
}
