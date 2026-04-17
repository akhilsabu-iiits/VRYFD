import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// Types
export interface AttendanceRecord {
  eventId: number;
  attendee: string;
  joinTime: number;
  leaveTime: number | null;
  duration: number;
  attendancePercentage: number;
}

export interface EventStatistics {
  eventId: number;
  totalParticipants: number;
  currentParticipants: number;
  averageAttendance: number;
  eligibleCount: number;
  attendanceDistribution: {
    range: string;
    count: number;
  }[];
}

export interface EligibleAttendee {
  address: string;
  ens?: string;
  attendancePercentage: number;
  duration: number;
  isEligible: boolean;
}

/**
 * Hook to track webinar attendance automatically
 * Sends join/leave events to backend API
 */
export function useWebinarTracking(eventId: number | null, isActive: boolean = false) {
  const { address } = useAccount();
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Track join event
  const trackJoin = useCallback(async () => {
    if (!eventId || !address || isTracking) return;

    try {
      const response = await fetch(`${BACKEND}/api/attendance/webinar/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, attendee: address }),
      });

      if (!response.ok) {
        throw new Error('Failed to track join');
      }

      const data = await response.json();
      setSessionId(data.sessionId);
      setIsTracking(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [eventId, address, isTracking]);

  // Track leave event
  const trackLeave = useCallback(async () => {
    if (!eventId || !address || !sessionId) return;

    try {
      await fetch(`${BACKEND}/api/attendance/webinar/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, attendee: address, sessionId }),
      });

      setIsTracking(false);
      setSessionId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [eventId, address, sessionId]);

  // Auto-track based on isActive prop
  useEffect(() => {
    if (isActive && !isTracking) {
      trackJoin();
    } else if (!isActive && isTracking) {
      trackLeave();
    }
  }, [isActive, isTracking, trackJoin, trackLeave]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isTracking) {
        trackLeave();
      }
    };
  }, [isTracking, trackLeave]);

  // Send heartbeat every 30 seconds to keep session alive
  useEffect(() => {
    if (!isTracking || !sessionId || !eventId || !address) return;

    const interval = setInterval(async () => {
      try {
        await fetch(`${BACKEND}/api/attendance/webinar/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId, attendee: address, sessionId }),
        });
      } catch (err) {
        console.error('Heartbeat failed:', err);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [isTracking, sessionId, eventId, address]);

  return {
    isTracking,
    error,
    trackJoin,
    trackLeave,
  };
}

/**
 * Hook to fetch attendance details for a user
 */
export function useAttendanceDetails(eventId: number | null, attendee?: string) {
  const { address } = useAccount();
  const [attendance, setAttendance] = useState<AttendanceRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetAddress = attendee || address;

  const fetchAttendance = useCallback(async () => {
    if (!eventId || !targetAddress) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${BACKEND}/api/attendance/details/${eventId}/${targetAddress}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch attendance');
      }

      const data = await response.json();
      setAttendance(data.attendance);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setAttendance(null);
    } finally {
      setIsLoading(false);
    }
  }, [eventId, targetAddress]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  return {
    attendance,
    isLoading,
    error,
    refetch: fetchAttendance,
  };
}

/**
 * Hook to fetch event statistics for organizers
 */
export function useEventStatistics(eventId: number | null) {
  const [statistics, setStatistics] = useState<EventStatistics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatistics = useCallback(async () => {
    if (!eventId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${BACKEND}/api/attendance/statistics/${eventId}`);

      if (!response.ok) {
        throw new Error('Failed to fetch statistics');
      }

      const data = await response.json();
      setStatistics(data.statistics);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatistics(null);
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchStatistics();

    // Poll every 10 seconds for live updates
    const interval = setInterval(fetchStatistics, 10000);
    return () => clearInterval(interval);
  }, [fetchStatistics]);

  return {
    statistics,
    isLoading,
    error,
    refetch: fetchStatistics,
  };
}

/**
 * Hook to fetch eligible attendees for an event
 */
export function useEligibleAttendees(eventId: number | null) {
  const [attendees, setAttendees] = useState<EligibleAttendee[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEligible = useCallback(async () => {
    if (!eventId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${BACKEND}/api/attendance/eligible/${eventId}`);

      if (!response.ok) {
        throw new Error('Failed to fetch eligible attendees');
      }

      const data = await response.json();
      setAttendees(data.attendees || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setAttendees([]);
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchEligible();
  }, [fetchEligible]);

  return {
    attendees,
    isLoading,
    error,
    refetch: fetchEligible,
  };
}

/**
 * Hook to submit attendance records to blockchain
 */
export function useSubmitAttendance() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitAttendance = useCallback(async (eventId: number, attendees: string[]) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${BACKEND}/api/attendance/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, attendees }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit attendance');
      }

      const data = await response.json();
      return data;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return {
    submitAttendance,
    isSubmitting,
    error,
  };
}
