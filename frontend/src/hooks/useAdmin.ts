import { useState, useEffect, useCallback } from 'react';
import { useAccount, useSignMessage } from 'wagmi';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface AdminInfo {
  walletAddress: string;
  role: 'SUPER_ADMIN' | 'MODERATOR' | 'SUPPORT';
  name: string;
  email: string;
  isActive: boolean;
  permissions: {
    canSuspendEvents: boolean;
    canSuspendUsers: boolean;
    canDeleteEvents: boolean;
    canManageAdmins: boolean;
    canViewMetrics: boolean;
    canViewLogs: boolean;
  };
}

interface DashboardMetrics {
  totalEvents: number;
  virtualEvents: number;
  physicalEvents: number;
  hybridEvents: number;
  activeEvents: number;
  completedEvents: number;
  suspendedEvents: number;
  totalUsers: number;
  totalOrganizers: number;
  totalAttendance: number;
  chainUsage: Record<string, number>;
  recentEvents: any[];
}

interface AbuseReport {
  _id: string;
  reportType: string;
  targetId: string;
  targetAddress?: string;
  reason: string;
  description: string;
  reportedBy: string;
  status: 'PENDING' | 'INVESTIGATING' | 'RESOLVED' | 'DISMISSED';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  autoDetected: boolean;
  createdAt: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: Get auth headers
// ──────────────────────────────────────────────────────────────────────────────

async function getAuthHeaders(address: string, signMessage: (args: { message: string }) => Promise<string>) {
  const message = `Admin authentication: ${Date.now()}`;
  const signature = await signMessage({ message });
  
  return {
    'x-admin-address': address,
    'x-admin-signature': signature,
    'x-admin-message': message,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// useAdminAuth - Check if user is admin and get auth headers
// ──────────────────────────────────────────────────────────────────────────────

export function useAdminAuth() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminInfo, setAdminInfo] = useState<AdminInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const authenticate = useCallback(async () => {
    if (!address || !signMessageAsync) {
      setIsAdmin(false);
      setAdminInfo(null);
      setLoading(false);
      return null;
    }

    try {
      const headers = await getAuthHeaders(address, signMessageAsync);
      
      const response = await fetch(`${API_URL}/api/admin/me`, {
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setIsAdmin(true);
        setAdminInfo(data.data);
        return headers;
      } else {
        setIsAdmin(false);
        setAdminInfo(null);
        return null;
      }
    } catch (error) {
      console.error('Admin auth error:', error);
      setIsAdmin(false);
      setAdminInfo(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [address, signMessageAsync]);

  useEffect(() => {
    authenticate();
  }, [authenticate]);

  return { isAdmin, adminInfo, loading, authenticate };
}

// ──────────────────────────────────────────────────────────────────────────────
// useAdminDashboard - Fetch dashboard metrics
// ──────────────────────────────────────────────────────────────────────────────

export function useAdminDashboard() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    if (!address || !signMessageAsync) return;

    try {
      setLoading(true);
      const headers = await getAuthHeaders(address, signMessageAsync);
      
      const response = await fetch(`${API_URL}/api/admin/dashboard`, {
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      });

      const data = await response.json();
      
      if (data.success) {
        setMetrics(data.data);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch dashboard');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [address, signMessageAsync]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  return { metrics, loading, error, refetch: fetchDashboard };
}

// ──────────────────────────────────────────────────────────────────────────────
// useAdminEvents - Manage events
// ──────────────────────────────────────────────────────────────────────────────

export function useAdminEvents(filters?: { type?: string; status?: string; organizer?: string; search?: string }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!address || !signMessageAsync) return;

    try {
      setLoading(true);
      const headers = await getAuthHeaders(address, signMessageAsync);
      
      const params = new URLSearchParams();
      if (filters?.type) params.append('type', filters.type);
      if (filters?.status) params.append('status', filters.status);
      if (filters?.organizer) params.append('organizer', filters.organizer);
      if (filters?.search) params.append('search', filters.search);
      
      const response = await fetch(`${API_URL}/api/admin/events?${params}`, {
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      });

      const data = await response.json();
      
      if (data.success) {
        setEvents(data.data);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch events');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [address, signMessageAsync, filters?.type, filters?.status, filters?.organizer, filters?.search]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return { events, loading, error, refetch: fetchEvents };
}

// ──────────────────────────────────────────────────────────────────────────────
// useSuspendEvent - Suspend an event
// ──────────────────────────────────────────────────────────────────────────────

export function useSuspendEvent() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(false);

  const suspendEvent = async (eventId: string, reason: string) => {
    if (!address || !signMessageAsync) {
      throw new Error('Not authenticated');
    }

    try {
      setLoading(true);
      const headers = await getAuthHeaders(address, signMessageAsync);
      
      const response = await fetch(`${API_URL}/api/admin/events/${eventId}/suspend`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({ reason }),
      });

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to suspend event');
      }
      
      return data;
    } finally {
      setLoading(false);
    }
  };

  return { suspendEvent, loading };
}

// ──────────────────────────────────────────────────────────────────────────────
// useRestoreEvent - Restore a suspended event
// ──────────────────────────────────────────────────────────────────────────────

export function useRestoreEvent() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(false);

  const restoreEvent = async (eventId: string) => {
    if (!address || !signMessageAsync) {
      throw new Error('Not authenticated');
    }

    try {
      setLoading(true);
      const headers = await getAuthHeaders(address, signMessageAsync);
      
      const response = await fetch(`${API_URL}/api/admin/events/${eventId}/restore`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      });

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to restore event');
      }
      
      return data;
    } finally {
      setLoading(false);
    }
  };

  return { restoreEvent, loading };
}

// ──────────────────────────────────────────────────────────────────────────────
// useAdminUsers - Manage users
// ──────────────────────────────────────────────────────────────────────────────

export function useAdminUsers(search?: string) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    if (!address || !signMessageAsync) return;

    try {
      setLoading(true);
      const headers = await getAuthHeaders(address, signMessageAsync);
      
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      
      const response = await fetch(`${API_URL}/api/admin/users?${params}`, {
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      });

      const data = await response.json();
      
      if (data.success) {
        setUsers(data.data);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch users');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [address, signMessageAsync, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  return { users, loading, error, refetch: fetchUsers };
}

// ──────────────────────────────────────────────────────────────────────────────
// useAdminMetrics - Fetch time-series metrics
// ──────────────────────────────────────────────────────────────────────────────

export function useAdminMetrics(period: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' = 'DAILY') {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    if (!address || !signMessageAsync) return;

    try {
      setLoading(true);
      const headers = await getAuthHeaders(address, signMessageAsync);
      
      const response = await fetch(`${API_URL}/api/admin/metrics?period=${period}`, {
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      });

      const data = await response.json();
      
      if (data.success) {
        setMetrics(data.data);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch metrics');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [address, signMessageAsync, period]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return { metrics, loading, error, refetch: fetchMetrics };
}

// ──────────────────────────────────────────────────────────────────────────────
// useAdminLogs - Fetch audit logs
// ──────────────────────────────────────────────────────────────────────────────

export function useAdminLogs(filters?: { action?: string; targetType?: string; limit?: number }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!address || !signMessageAsync) return;

    try {
      setLoading(true);
      const headers = await getAuthHeaders(address, signMessageAsync);
      
      const params = new URLSearchParams();
      if (filters?.action) params.append('action', filters.action);
      if (filters?.targetType) params.append('targetType', filters.targetType);
      if (filters?.limit) params.append('limit', filters.limit.toString());
      
      const response = await fetch(`${API_URL}/api/admin/logs?${params}`, {
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      });

      const data = await response.json();
      
      if (data.success) {
        setLogs(data.data);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch logs');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [address, signMessageAsync, filters?.action, filters?.targetType, filters?.limit]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return { logs, loading, error, refetch: fetchLogs };
}

// ──────────────────────────────────────────────────────────────────────────────
// useAbuseReports - Fetch abuse reports
// ──────────────────────────────────────────────────────────────────────────────

export function useAbuseReports(filters?: { status?: string; severity?: string; reportType?: string }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [reports, setReports] = useState<AbuseReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    if (!address || !signMessageAsync) return;

    try {
      setLoading(true);
      const headers = await getAuthHeaders(address, signMessageAsync);
      
      const params = new URLSearchParams();
      if (filters?.status) params.append('status', filters.status);
      if (filters?.severity) params.append('severity', filters.severity);
      if (filters?.reportType) params.append('reportType', filters.reportType);
      
      const response = await fetch(`${API_URL}/api/admin/abuse?${params}`, {
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      });

      const data = await response.json();
      
      if (data.success) {
        setReports(data.data);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch reports');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [address, signMessageAsync, filters?.status, filters?.severity, filters?.reportType]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const createReport = async (reportData: {
    reportType: string;
    targetId: string;
    targetAddress?: string;
    reason: string;
    description?: string;
    severity?: string;
  }) => {
    if (!address || !signMessageAsync) {
      throw new Error('Not authenticated');
    }

    const headers = await getAuthHeaders(address, signMessageAsync);
    
    const response = await fetch(`${API_URL}/api/admin/abuse/flag`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(reportData),
    });

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to create report');
    }
    
    await fetchReports();
    return data;
  };

  const resolveReport = async (reportId: string, action: string, notes?: string) => {
    if (!address || !signMessageAsync) {
      throw new Error('Not authenticated');
    }

    const headers = await getAuthHeaders(address, signMessageAsync);
    
    const response = await fetch(`${API_URL}/api/admin/abuse/${reportId}/resolve`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({ action, notes }),
    });

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to resolve report');
    }
    
    await fetchReports();
    return data;
  };

  return { reports, loading, error, refetch: fetchReports, createReport, resolveReport };
}
