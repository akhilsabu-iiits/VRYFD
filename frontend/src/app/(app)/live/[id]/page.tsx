"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { io, Socket } from "socket.io-client";
import { useAuth } from "../../../../contexts/AuthContext";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

interface PeerState {
  pc: RTCPeerConnection;
  userName: string;
}

export default function LiveSessionPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const eventId = params?.id;
  const isQrCheckin = searchParams?.get("checkin") === "true";
  const { user } = useAuth();

  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Join-approval flow state
  const [joinStatus, setJoinStatus] = useState<"none" | "pending" | "approved" | "rejected">("none");
  const [joinCode, setJoinCode] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [checkinTx, setCheckinTx] = useState<string | null>(null);
  const [checkedInOnChain, setCheckedInOnChain] = useState(false);

  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [joined, setJoined] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, { stream: MediaStream; userName: string }>>(new Map());
  const [meetingEnded, setMeetingEnded] = useState(false);
  const [endingMeeting, setEndingMeeting] = useState(false);
  const [checkedOut, setCheckedOut] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, PeerState>>(new Map());

  // Fetch event
  useEffect(() => {
    if (!eventId) return;
    fetch(`${BACKEND_URL}/api/relay/events`)
      .then((r) => r.json())
      .then((data) => {
        const events = data.events || [];
        const found = events.find(
          (e: any) =>
            String(e.id) === String(eventId) ||
            String(e.eventId) === String(eventId) ||
            String(e.onChainId) === String(eventId)
        );
        setEvent(found || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [eventId]);

  // Poll current attendee's join-approval status so the UI transitions
  // automatically once the organizer accepts/rejects.
  const onChainIdForStatus = event?.onChainId || event?.eventId || event?.id;
  useEffect(() => {
    if (!onChainIdForStatus || !user?.address) return;
    if (checkedIn) return; // no more polling once they're in
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const r = await fetch(
          `${BACKEND_URL}/api/attendance/join-status/${onChainIdForStatus}/${user.address}`
        );
        const d = await r.json();
        if (cancelled) return;
        if (d.status) setJoinStatus(d.status);
        if (d.checkedInOnChain) setCheckedInOnChain(true);
        if (d.checkinTx) setCheckinTx(d.checkinTx);
      } catch { /* best effort */ }
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [onChainIdForStatus, user?.address, checkedIn]);

  // Host (organizer/admin) bypasses the approval flow — they can always manage/join their own event.
  const isHostRole = user?.role === "admin" || user?.role === "organizer";

  const handleRequestJoin = async () => {
    setRequestError(null);
    if (!user?.address) {
      setRequestError("Connect your wallet to request access");
      return;
    }
    if (!joinCode.trim()) {
      setRequestError("Enter the 6-character join code from the organizer");
      return;
    }
    if (!(window as any).ethereum) {
      setRequestError("MetaMask not detected. Please install or unlock it.");
      return;
    }
    const onChainId = event?.onChainId || event?.eventId || event?.id;
    const code = joinCode.trim().toUpperCase();
    // EIP-191 personal_sign — matches ethers.verifyMessage on the backend
    const message =
      `VRYFD – Request to Join\n\n` +
      `Event: ${onChainId}\n` +
      `Attendee: ${user.address.toLowerCase()}\n` +
      `Join Code: ${code}`;

    setRequesting(true);
    try {
      const signature = await (window as any).ethereum.request({
        method: "personal_sign",
        params: [message, user.address],
      });

      const res = await fetch(`${BACKEND_URL}/api/attendance/request-join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: Number(onChainId),
          attendee: user.address,
          joinCode: code,
          signature,
          name: user.name || user.ensName || null,
          email: user.email || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setJoinStatus(data.status || "pending");
      // On-chain check-in lands AFTER organizer approval — these may already be
      // set if the attendee had previously been approved (re-visit case).
      if (data.checkedInOnChain) setCheckedInOnChain(true);
      if (data.checkinTx) setCheckinTx(data.checkinTx);
    } catch (err: any) {
      if (err?.code === 4001 || /user rejected/i.test(err?.message || "")) {
        setRequestError("You cancelled the signature request");
      } else {
        setRequestError(err?.message || "Failed to send join request");
      }
    } finally {
      setRequesting(false);
    }
  };

  // Session timer — only ticks while the user is actively checked in
  // and has not yet checked out / the meeting hasn't ended.
  // Stopping here is also important so the counter doesn't keep running
  // after the component unmounts (e.g. navigating to another page).
  useEffect(() => {
    if (!checkedIn || checkedOut || meetingEnded) return;
    const interval = setInterval(() => setElapsed((p) => p + 1), 1000);
    return () => clearInterval(interval);
  }, [checkedIn, checkedOut, meetingEnded]);

  // Create peer connection for a remote socket
  const createPeerConnection = useCallback((remoteSocketId: string, userName: string) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    // Add local tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, streamRef.current!);
      });
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, screenStreamRef.current!);
      });
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current) {
        socketRef.current.emit("ice-candidate", { to: remoteSocketId, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (stream) {
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.set(remoteSocketId, { stream, userName });
          return next;
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        pc.close();
        peersRef.current.delete(remoteSocketId);
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.delete(remoteSocketId);
          return next;
        });
      }
    };

    peersRef.current.set(remoteSocketId, { pc, userName });
    return pc;
  }, []);

  // Join room — start camera + connect signaling
  const joinRoom = useCallback(async () => {
    // 1. Check-in automatically when joining (one button = join + check in)
    //    This enforces the lifecycle gate: if the event is not live, joining is blocked.
    if (!checkedIn) {
      const ok = await handleCheckInRef.current?.();
      if (ok === false) return; // backend rejected (event not started/ended)
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setCamOn(true);
      setMicOn(true);
    } catch {
      // No camera — join audio only or just signaling
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        setMicOn(true);
      } catch {
        // No media at all — still join for receiving
      }
    }

    const roomId = `vryfd-live-${event?.onChainId || event?.id || eventId}`;
    const userName = user?.name || user?.email || "Guest";
    const socket = io(BACKEND_URL, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join-room", { roomId, userId: user?.email || user?.address || socket.id, userName });
      setJoined(true);
    });

    // Someone new joined — create offer
    socket.on("user-joined", async ({ socketId, userName: name }) => {
      setParticipantCount((p) => p + 1);
      const pc = createPeerConnection(socketId, name);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("offer", { to: socketId, offer });
    });

    // Existing peers — wait for their offers
    socket.on("existing-peers", (peers: { socketId: string; userName: string }[]) => {
      setParticipantCount(peers.length + 1);
    });

    // Received offer — answer it
    socket.on("offer", async ({ from, offer }) => {
      const existing = peersRef.current.get(from);
      const pc = existing?.pc || createPeerConnection(from, existing?.userName || "Peer");
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer", { to: from, answer });
    });

    // Received answer
    socket.on("answer", async ({ from, answer }) => {
      const peer = peersRef.current.get(from);
      if (peer) {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    // ICE candidate
    socket.on("ice-candidate", async ({ from, candidate }) => {
      const peer = peersRef.current.get(from);
      if (peer && candidate) {
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch { /* ignore */ }
      }
    });

    // User left
    socket.on("user-left", ({ socketId }) => {
      setParticipantCount((p) => Math.max(0, p - 1));
      const peer = peersRef.current.get(socketId);
      if (peer) {
        peer.pc.close();
        peersRef.current.delete(socketId);
      }
      setRemoteStreams((prev) => {
        const next = new Map(prev);
        next.delete(socketId);
        return next;
      });
    });

    const handleForcedEnd = (reason: string) => {
      console.log(`[live] session ended (${reason}) — auto-checkout`);
      setMeetingEnded(true);
      setCheckedOut(true);
      setJoined(false);
      setParticipantCount(0);
      setRemoteStreams(new Map());
      streamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      peersRef.current.forEach((p) => p.pc.close());
      peersRef.current.clear();
      socket.disconnect();
      // Refresh event status from server so UI reflects "ended" state
      refetchEventRef.current?.();
      // Auto checkout on forced end
      if (event && user?.address) {
        const eid = event.onChainId || event.eventId || event.id;
        fetch(`${BACKEND_URL}/api/attendance/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: Number(eid), attendee: user.address }),
        }).catch(() => {});
      }
    };

    // Host ended the meeting (existing handler — kept for backward compat)
    socket.on("meeting-ended", () => handleForcedEnd("meeting-ended"));

    // Organizer/admin closed the event from the manage dashboard
    socket.on("event-ended", ({ reason }: { reason?: string }) => {
      handleForcedEnd(reason || "event-ended");
    });
  }, [event, eventId, user, createPeerConnection]);

  // Cleanup on unmount — auto checkout
  useEffect(() => {
    const doCheckout = () => {
      if (checkedIn && !checkedOut && event && user?.address) {
        const onChainId = event.onChainId || event.eventId || event.id;
        navigator.sendBeacon(
          `${BACKEND_URL}/api/attendance/checkout`,
          new Blob(
            [JSON.stringify({ eventId: Number(onChainId), attendee: user.address })],
            { type: "application/json" }
          )
        );
      }
    };
    window.addEventListener("beforeunload", doCheckout);
    return () => {
      window.removeEventListener("beforeunload", doCheckout);
      doCheckout();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      socketRef.current?.disconnect();
      peersRef.current.forEach((p) => p.pc.close());
      peersRef.current.clear();
    };
  }, [checkedIn, checkedOut, event, user]);

  // Replace tracks on all peers when screen sharing starts/stops
  const replaceTrackOnPeers = useCallback((newTrack: MediaStreamTrack, kind: string) => {
    peersRef.current.forEach(({ pc }) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === kind);
      if (sender) {
        sender.replaceTrack(newTrack);
      } else {
        // If no sender of that kind, add the track
        const stream = kind === "video" ? (screenStreamRef.current || streamRef.current) : streamRef.current;
        if (stream) pc.addTrack(newTrack, stream);
      }
    });
  }, []);

  const toggleMic = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setMicOn(track.enabled);
    }
  }, []);

  const toggleCam = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setCamOn(track.enabled);
    }
  }, []);

  const toggleScreenShare = useCallback(async () => {
    if (screenSharing) {
      // Stop screen share — revert to camera
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setScreenSharing(false);
      const camTrack = streamRef.current?.getVideoTracks()[0];
      if (camTrack) replaceTrackOnPeers(camTrack, "video");
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = screen;
      setScreenSharing(true);
      const screenTrack = screen.getVideoTracks()[0];
      replaceTrackOnPeers(screenTrack, "video");
      screenTrack.onended = () => {
        screenStreamRef.current = null;
        setScreenSharing(false);
        const camTrack = streamRef.current?.getVideoTracks()[0];
        if (camTrack) replaceTrackOnPeers(camTrack, "video");
      };
    } catch { /* user cancelled */ }
  }, [screenSharing, replaceTrackOnPeers]);

  // Check-in logic — wallet required (PRD §11)
  const canCheckIn = !!user?.address;

  const safeJson = async (res: Response) => {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { error: text.slice(0, 120) }; }
  };

  const refetchEvent = () => {
    fetch(`${BACKEND_URL}/api/relay/events`)
      .then((r) => r.json())
      .then((data) => {
        const events = data.events || [];
        const found = events.find(
          (e: any) =>
            String(e.id) === String(eventId) ||
            String(e.eventId) === String(eventId) ||
            String(e.onChainId) === String(eventId)
        );
        if (found) setEvent(found);
      })
      .catch(() => {});
  };

  // Ref so Socket.IO handlers inside joinRoom can trigger a refetch
  // without being in the useCallback dependency list.
  const refetchEventRef = useRef(refetchEvent);
  useEffect(() => {
    refetchEventRef.current = refetchEvent;
  });

  /**
   * Check in the current attendee.
   * Returns true on success, false on failure (so callers like joinRoom can abort).
   * Order matters:
   *   1. Session check-in first (cheap, enforces lifecycle gate via /api/attendance/checkin)
   *   2. On-chain markAttendance second (gas, slower, fire-and-forget if it fails)
   */
  const handleCheckIn = async (): Promise<boolean> => {
    if (!event) return false;
    if (!user?.address) {
      setCheckInError("Please connect your wallet to check in");
      return false;
    }
    setCheckingIn(true);
    setCheckInError(null);
    try {
      const onChainId = event.onChainId || event.eventId || event.id;

      // 1) Session check-in — this is what the organizer-dashboard reads.
      //    It also enforces lifecycle gating (rejects if event hasn't started or has ended).
      const sessionRes = await fetch(`${BACKEND_URL}/api/attendance/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: Number(onChainId),
          attendee: user.address,
          email: user.email,
          name: user.name || user.ensName || null,
        }),
      });
      const sessionData = await safeJson(sessionRes);
      if (!sessionRes.ok) {
        setCheckInError(sessionData.error || "Check-in failed");
        return false;
      }

      // 2) Best-effort on-chain attendance (independent of session result)
      fetch(`${BACKEND_URL}/api/relay/markAttendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: Number(onChainId), attendee: user.address }),
      }).catch(() => {});

      setCheckedIn(true);
      refetchEvent();
      return true;
    } catch (err: any) {
      setCheckInError(err?.message || "Network error");
      return false;
    } finally {
      setCheckingIn(false);
    }
  };

  // Ref so joinRoom (defined earlier in the file) can call handleCheckIn
  // without creating a circular useCallback dependency.
  const handleCheckInRef = useRef(handleCheckIn);
  useEffect(() => {
    handleCheckInRef.current = handleCheckIn;
  });

  // Auto-check-in when arriving via QR code scan
  const qrCheckinTriggered = useRef(false);
  useEffect(() => {
    if (isQrCheckin && event && user && !checkedIn && !checkingIn && !qrCheckinTriggered.current) {
      qrCheckinTriggered.current = true;
      handleCheckIn();
    }
  }, [isQrCheckin, event, user, checkedIn, checkingIn]);

  const isHost = user?.role === "admin" || user?.role === "organizer";

  const handleEndMeeting = async () => {
    if (!event || !isHost) return;
    if (!confirm("Are you sure you want to end this meeting for all participants?")) return;
    setEndingMeeting(true);
    try {
      const onChainId = event.onChainId || event.eventId || event.id;
      const token = localStorage.getItem("vryfd_token");
      const res = await fetch(`${BACKEND_URL}/api/relay/endMeeting`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ eventId: onChainId }),
      });
      const data = await safeJson(res);
      if (res.ok || data.success) {
        const roomId = `vryfd-live-${event?.onChainId || event?.id || eventId}`;
        socketRef.current?.emit("end-meeting", { roomId });
        await performCheckout();
        setMeetingEnded(true);
        setCheckedOut(true);
        setJoined(false);
        setParticipantCount(0);
        setRemoteStreams(new Map());
        streamRef.current?.getTracks().forEach((t) => t.stop());
        screenStreamRef.current?.getTracks().forEach((t) => t.stop());
        socketRef.current?.disconnect();
        peersRef.current.forEach((p) => p.pc.close());
        peersRef.current.clear();
      } else {
        alert(data.error || "Failed to end meeting");
      }
    } catch {
      alert("Network error — could not end meeting");
    } finally {
      setEndingMeeting(false);
    }
  };

  const performCheckout = useCallback(async () => {
    if (!event || !user?.address) return;
    const onChainId = event.onChainId || event.eventId || event.id;
    try {
      await fetch(`${BACKEND_URL}/api/attendance/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: Number(onChainId), attendee: user.address }),
      });
    } catch { /* best-effort */ }
  }, [event, user]);

  const handleLeaveMeeting = useCallback(async () => {
    setCheckingOut(true);
    await performCheckout();
    setCheckedOut(true);
    setJoined(false);
    setParticipantCount(0);
    setRemoteStreams(new Map());
    streamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    socketRef.current?.disconnect();
    peersRef.current.forEach((p) => p.pc.close());
    peersRef.current.clear();
    setCheckingOut(false);
  }, [performCheckout]);

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  // Get the "main" remote stream (first one, or the one that is screen sharing)
  const mainRemote = remoteStreams.size > 0 ? [...remoteStreams.values()][0] : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="spinner text-primary" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="text-center py-20">
        <span className="material-symbols-outlined text-5xl text-outline mb-4 block">videocam_off</span>
        <h2 className="text-xl font-bold font-headline text-on-surface mb-2">Session Not Found</h2>
        <Link href="/marketplace" className="text-primary font-bold hover:underline">Back to Marketplace</Link>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────
  // In-Person events: no video, just the check-in / approval flow.
  // Hybrid (2) keeps the full video UI below so remote attendees can
  // still join the live room alongside physical attendees.
  // ──────────────────────────────────────────────────────────────
  if (event.eventType === 1 && !isHostRole) {
    const onChainId = event.onChainId || event.eventId || event.id;
    return (
      <div className="space-y-4 max-w-2xl mx-auto">
        <nav className="flex items-center gap-2 text-sm text-on-surface-variant">
          <Link href="/marketplace" className="hover:text-primary transition-colors">Events</Link>
          <span className="material-symbols-outlined text-sm">chevron_right</span>
          <Link href={`/events/${eventId}`} className="hover:text-primary transition-colors">
            {event.name || `Event #${onChainId}`}
          </Link>
          <span className="material-symbols-outlined text-sm">chevron_right</span>
          <span className="text-on-surface font-medium">Check-In</span>
        </nav>

        <div className="bg-surface-container-lowest rounded-2xl shadow-ambient border border-outline-variant/10 overflow-hidden">
          <div className="px-8 py-6 border-b border-outline-variant/10 bg-indigo-50/40">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
                <span className="material-symbols-outlined text-indigo-600 text-3xl">location_on</span>
              </div>
              <div>
                <h1 className="text-xl font-bold font-headline text-on-surface">{event.name}</h1>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  In-Person event · Event #{onChainId}
                </p>
              </div>
            </div>
          </div>

          <div className="p-8">
            {joinStatus === "approved" ? (
              <div className="text-center space-y-5">
                <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                  <span className="material-symbols-outlined text-emerald-600 text-5xl">check_circle</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold font-headline text-on-surface mb-1">You&apos;re checked in</h2>
                  <p className="text-sm text-on-surface-variant">
                    Enjoy the event. Your attendance is recorded on-chain — claim your POAP and certificate from the Claim Center after the event ends.
                  </p>
                </div>
                {checkedInOnChain && (
                  <div className="inline-flex flex-col items-center gap-1 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                      <span className="material-symbols-outlined text-sm">link</span>
                      On-chain attendance recorded
                    </span>
                    {checkinTx && (
                      <a
                        href={`https://sepolia.etherscan.io/tx/${checkinTx}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-primary font-mono hover:underline"
                      >
                        Tx {checkinTx.slice(0, 10)}…{checkinTx.slice(-8)}
                      </a>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-3 justify-center">
                  <Link href="/claim" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 font-bold text-sm hover:bg-emerald-100">
                    <span className="material-symbols-outlined text-base">redeem</span>
                    Claim Center
                  </Link>
                  <Link href="/dashboard" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary/90">
                    <span className="material-symbols-outlined text-base">dashboard</span>
                    Dashboard
                  </Link>
                </div>
              </div>
            ) : joinStatus === "pending" ? (
              <div className="text-center space-y-5">
                <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
                  <div className="spinner text-amber-600" style={{ width: 40, height: 40 }} />
                </div>
                <div>
                  <h2 className="text-xl font-bold font-headline text-on-surface mb-1">Waiting for organizer approval…</h2>
                  <p className="text-sm text-on-surface-variant">
                    Your signature was received. Once the organizer confirms you&apos;re on-site, the relayer will record your on-chain check-in (no gas charged to you).
                  </p>
                </div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold">
                  <span className="material-symbols-outlined text-sm">edit</span>
                  Signature received
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-bold font-headline text-on-surface mb-1">Check in to {event.name}</h2>
                  <p className="text-sm text-on-surface-variant">
                    Enter the 6-character join code the organizer displayed, then sign the confirmation with MetaMask. This is free — no gas.
                  </p>
                </div>

                <div className="space-y-3">
                  <input
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                    placeholder="6-character code (e.g. 2JGTRS)"
                    maxLength={6}
                    className="w-full px-4 py-4 rounded-xl bg-surface-container-low border border-outline-variant/30 text-on-surface font-mono tracking-[0.3em] text-center text-xl placeholder:text-on-surface-variant/40 placeholder:tracking-normal placeholder:text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  {joinStatus === "rejected" && (
                    <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                      Your previous request was rejected. You can try again.
                    </div>
                  )}
                  {requestError && (
                    <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                      <span className="material-symbols-outlined text-sm">error</span>
                      {requestError}
                    </div>
                  )}
                  <button
                    onClick={handleRequestJoin}
                    disabled={requesting || !joinCode.trim() || !user?.address}
                    className="w-full px-6 py-3.5 rounded-xl prism-gradient text-white font-headline font-bold text-sm active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {requesting ? (
                      <>
                        <div className="spinner text-white" style={{ width: 14, height: 14 }} />
                        Signing…
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-base">verified_user</span>
                        Sign & Check In
                      </>
                    )}
                  </button>
                </div>

                <p className="text-[11px] text-on-surface-variant text-center">
                  You&apos;ll be asked to sign a plain message — MetaMask won&apos;t ask for gas.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (meetingEnded || (checkedOut && !joined)) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center max-w-md">
          <span className="material-symbols-outlined text-6xl text-primary mb-4 block">event_available</span>
          <h2 className="text-2xl font-bold font-headline text-on-surface mb-2">
            {meetingEnded ? "Meeting Ended" : "Checked Out"}
          </h2>
          <p className="text-on-surface-variant mb-6">
            {meetingEnded
              ? "This meeting has been ended by the host. Thank you for attending!"
              : "You have successfully checked out. Thank you for attending!"}
          </p>
          {checkedIn && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 mb-6">
              <p className="text-sm font-bold text-emerald-700 flex items-center justify-center gap-2">
                <span className="material-symbols-outlined">check_circle</span>
                Attendance Recorded
              </p>
              <p className="text-xs text-emerald-600 mt-1">Session duration: {formatTime(elapsed)}</p>
            </div>
          )}
          <div className="flex gap-3 justify-center">
            <Link href="/dashboard" className="px-5 py-2.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary/90 transition-colors">
              Go to Dashboard
            </Link>
            <Link href="/claim" className="px-5 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 font-bold text-sm hover:bg-emerald-100 transition-colors">
              Claim Rewards
            </Link>
            <Link href="/marketplace" className="px-5 py-2.5 rounded-xl bg-surface-container-low text-on-surface font-bold text-sm hover:bg-surface-container-high transition-colors">
              Browse Events
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-2 text-sm text-on-surface-variant">
        <Link href="/marketplace" className="hover:text-primary transition-colors">Events</Link>
        <span className="material-symbols-outlined text-sm">chevron_right</span>
        <Link href={`/events/${eventId}`} className="hover:text-primary transition-colors">
          {event.name || `Event #${event.id || event.eventId}`}
        </Link>
        <span className="material-symbols-outlined text-sm">chevron_right</span>
        <span className="text-on-surface font-medium">Live Session</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 space-y-3">
          {/* Main video area */}
          <div className="relative rounded-2xl overflow-hidden bg-slate-900" style={{ minHeight: "480px" }}>
            {/* Remote stream (main view) */}
            {mainRemote && (
              <video
                autoPlay
                playsInline
                className="absolute inset-0 w-full h-full object-contain z-[2]"
                ref={(el) => { if (el && el.srcObject !== mainRemote.stream) el.srcObject = mainRemote.stream; }}
              />
            )}

            {/* Local video when no remote, or camera-off state */}
            {!mainRemote && joined && camOn && (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover z-[2]"
              />
            )}

            {/* Local video PIP when remote is showing */}
            {mainRemote && joined && (
              <div className="absolute bottom-4 right-4 w-44 h-32 rounded-xl overflow-hidden border-2 border-white/30 shadow-xl z-10 bg-slate-800">
                {camOn ? (
                  <video
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                    ref={(el) => { if (el && streamRef.current) el.srcObject = streamRef.current; }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/40">
                    <span className="material-symbols-outlined text-2xl">videocam_off</span>
                  </div>
                )}
                <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px]">You</div>
              </div>
            )}

            {/* Not joined yet — approval gate */}
            {!joined && (
              <div className="absolute inset-0 flex items-center justify-center z-[6] px-6">
                <div className="text-center max-w-md w-full">
                  <span className="material-symbols-outlined text-6xl text-white/30 mb-3 block">videocam</span>
                  <p className="text-white/80 font-headline font-bold text-lg mb-1">{event.name || "Live Session"}</p>

                  {/* STATE 1 — hosts (admin/organizer): skip the approval gate */}
                  {isHostRole ? (
                    <>
                      <p className="text-white/40 text-sm mb-5">Host mode — you can join directly</p>
                      <button
                        onClick={joinRoom}
                        className="px-6 py-3 rounded-xl bg-primary text-white font-headline font-bold text-sm hover:bg-primary/90 active:scale-95 transition-all flex items-center gap-2 mx-auto"
                      >
                        <span className="material-symbols-outlined">video_call</span>
                        Join Meeting as Host
                      </button>
                    </>
                  ) : joinStatus === "approved" ? (
                    // STATE 2 — approved: attendance locked in on-chain, show Join Meeting button
                    <>
                      <div className="mb-3 mx-auto inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/20 text-emerald-300 text-sm font-bold">
                        <span className="material-symbols-outlined text-base">check_circle</span>
                        Approved — you can join now
                      </div>
                      {checkedInOnChain && (
                        <div className="mb-3 mx-auto inline-flex flex-col items-center gap-1">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold">
                            <span className="material-symbols-outlined text-xs">link</span>
                            On-chain attendance recorded
                          </span>
                          {checkinTx && (
                            <a
                              href={`https://sepolia.etherscan.io/tx/${checkinTx}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-primary/80 font-mono hover:underline"
                            >
                              Tx {checkinTx.slice(0, 10)}…{checkinTx.slice(-8)}
                            </a>
                          )}
                        </div>
                      )}
                      <button
                        onClick={joinRoom}
                        className="px-6 py-3 rounded-xl bg-primary text-white font-headline font-bold text-sm hover:bg-primary/90 active:scale-95 transition-all flex items-center gap-2 mx-auto"
                      >
                        <span className="material-symbols-outlined">video_call</span>
                        Join Meeting
                      </button>
                    </>
                  ) : joinStatus === "pending" ? (
                    // STATE 3 — signature sent, waiting for organizer approval
                    <>
                      <div className="mb-3 mx-auto inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold">
                        <span className="material-symbols-outlined text-sm">edit</span>
                        Signature received
                      </div>
                      <div className="mb-4 mx-auto inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/20 text-amber-300 text-sm font-bold">
                        <div className="spinner text-amber-300" style={{ width: 14, height: 14 }} />
                        Waiting for organizer approval…
                      </div>
                      <p className="text-white/40 text-xs">
                        Once the organizer approves, the relayer will record your on-chain check-in (no gas charged to you) and you&apos;ll enter the meeting.
                      </p>
                    </>
                  ) : (
                    // STATE 4 — default: enter join code + sign
                    <>
                      <p className="text-white/40 text-sm mb-5">Enter the join code given by the organizer and sign to request entry</p>
                      <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-5 space-y-3">
                        <input
                          type="text"
                          value={joinCode}
                          onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                          placeholder="6-character code (e.g. 2JGTRS)"
                          maxLength={6}
                          className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/20 text-white font-mono tracking-[0.3em] text-center text-lg placeholder:text-white/20 placeholder:tracking-normal placeholder:text-sm focus:outline-none focus:border-primary"
                        />
                        {joinStatus === "rejected" && (
                          <div className="px-3 py-2 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-xs">
                            Your previous request was rejected. You can try again.
                          </div>
                        )}
                        {requestError && (
                          <div className="px-3 py-2 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                            <span className="material-symbols-outlined text-sm">error</span>
                            {requestError}
                          </div>
                        )}
                        <button
                          onClick={handleRequestJoin}
                          disabled={requesting || !joinCode.trim() || !user?.address}
                          className="w-full px-6 py-3 rounded-xl bg-primary text-white font-headline font-bold text-sm hover:bg-primary/90 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {requesting ? (
                            <>
                              <div className="spinner text-white" style={{ width: 14, height: 14 }} />
                              Signing…
                            </>
                          ) : (
                            <>
                              <span className="material-symbols-outlined">draw</span>
                              Sign &amp; Request Entry
                            </>
                          )}
                        </button>
                        {!user?.address && (
                          <p className="text-xs text-amber-300">Connect your wallet first (top-right of the login page).</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Joined but no remote and cam off */}
            {joined && !mainRemote && !camOn && (
              <div className="absolute inset-0 flex items-center justify-center z-[4]">
                <div className="text-center text-white/40">
                  <span className="material-symbols-outlined text-7xl mb-3 block">videocam_off</span>
                  <p className="text-sm font-headline">Camera is off</p>
                  <p className="text-xs text-white/25 mt-1">Waiting for other participants...</p>
                </div>
              </div>
            )}

            {/* Remote user name */}
            {mainRemote && (
              <div className="absolute top-4 right-4 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur text-white text-xs font-bold z-20 pointer-events-none">
                {mainRemote.userName}
              </div>
            )}

            {/* LIVE badge */}
            <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500 text-white text-xs font-bold z-20 pointer-events-none">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              LIVE
            </div>

            {/* Timer */}
            {/* Session timer is shown only in the sidebar (Session Time card).
                We intentionally keep the video area uncluttered per UX feedback. */}

            {/* Muted indicator */}
            {joined && !micOn && (
              <div className="absolute bottom-4 left-4 flex items-center gap-1 px-3 py-1.5 rounded-full bg-red-500/80 text-white text-xs font-bold z-20 pointer-events-none">
                <span className="material-symbols-outlined text-sm">mic_off</span>
                Muted
              </div>
            )}
          </div>

          {/* Additional remote streams (gallery) */}
          {remoteStreams.size > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {[...remoteStreams.entries()].slice(1).map(([sid, { stream, userName }]) => (
                <div key={sid} className="relative w-48 h-32 rounded-xl overflow-hidden bg-slate-800 flex-shrink-0 border border-white/10">
                  <video
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                    ref={(el) => { if (el && el.srcObject !== stream) el.srcObject = stream; }}
                  />
                  <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px]">{userName}</div>
                </div>
              ))}
            </div>
          )}

          {/* Controls bar */}
          <div className="flex items-center justify-between p-3 bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10">
            <div className="flex items-center gap-3">
              <h2 className="font-bold font-headline text-on-surface text-sm lg:text-base">{event.name}</h2>
              {joined && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Connected
                </span>
              )}
              {joined && participantCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant">
                  <span className="material-symbols-outlined text-sm">group</span>
                  {participantCount} in meeting
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={toggleMic} disabled={!joined}
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30 ${micOn ? "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high" : "bg-red-500 text-white"}`}
                title={micOn ? "Mute" : "Unmute"}>
                <span className="material-symbols-outlined">{micOn ? "mic" : "mic_off"}</span>
              </button>
              <button onClick={toggleCam} disabled={!joined}
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30 ${camOn ? "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high" : "bg-red-500 text-white"}`}
                title={camOn ? "Camera off" : "Camera on"}>
                <span className="material-symbols-outlined">{camOn ? "videocam" : "videocam_off"}</span>
              </button>
              <button onClick={toggleScreenShare} disabled={!joined}
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30 ${screenSharing ? "bg-primary text-white" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"}`}
                title={screenSharing ? "Stop sharing" : "Share screen"}>
                <span className="material-symbols-outlined">{screenSharing ? "stop_screen_share" : "screen_share"}</span>
              </button>
              {joined && !isHost && (
                <button onClick={handleLeaveMeeting} disabled={checkingOut}
                  className="h-10 px-4 rounded-lg bg-red-500 text-white text-xs font-bold flex items-center gap-1.5 hover:bg-red-600 transition-colors disabled:opacity-50"
                  title="Leave meeting and check out">
                  <span className="material-symbols-outlined text-sm">logout</span>
                  {checkingOut ? "Leaving..." : "Leave"}
                </button>
              )}
              {isHost && joined && (
                <button onClick={handleEndMeeting} disabled={endingMeeting}
                  className="h-10 px-4 rounded-lg bg-red-500 text-white text-xs font-bold flex items-center gap-1.5 hover:bg-red-600 transition-colors disabled:opacity-50"
                  title="End meeting for all">
                  <span className="material-symbols-outlined text-sm">call_end</span>
                  {endingMeeting ? "Ending..." : "End Meeting"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-surface-container-lowest rounded-xl p-5 shadow-ambient border border-outline-variant/10">
            <h3 className="font-bold font-headline text-on-surface mb-3 flex items-center gap-2 text-sm">
              <span className="material-symbols-outlined text-primary text-lg">how_to_reg</span>
              Attendance
            </h3>
            {checkedOut ? (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                  <p className="text-sm font-bold text-blue-700 flex items-center gap-2">
                    <span className="material-symbols-outlined text-base">logout</span>
                    Checked Out
                  </p>
                  <p className="text-xs text-blue-600 mt-1">Session completed. Duration: {formatTime(elapsed)}</p>
                </div>
                <div className="flex gap-2">
                  <a href="/dashboard" className="flex-1 py-2 rounded-lg bg-primary text-white text-xs font-bold text-center hover:bg-primary/90 transition-colors">
                    Dashboard
                  </a>
                  <a href="/claim" className="flex-1 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold text-center hover:bg-emerald-100 transition-colors">
                    Claim Rewards
                  </a>
                </div>
              </div>
            ) : checkedIn ? (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                  <p className="text-sm font-bold text-emerald-700 flex items-center gap-2">
                    <span className="material-symbols-outlined text-base">check_circle</span>
                    Checked In
                  </p>
                  <p className="text-xs text-emerald-600 mt-1">Attendance is being recorded on-chain.</p>
                </div>
                <div className="p-3 rounded-lg bg-surface-container-low">
                  <p className="text-xs text-on-surface-variant font-label uppercase tracking-wider">Session Time</p>
                  <p className="text-lg font-bold font-mono text-on-surface mt-1">{formatTime(elapsed)}</p>
                </div>
                <p className="text-[11px] text-on-surface-variant text-center">
                  Use the <strong>Leave</strong> button in the controls bar to check out
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                  <p className="text-xs text-blue-700 flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm">info</span>
                    Click <strong>Join Meeting</strong> to check in &amp; start your session
                  </p>
                </div>
                {checkInError && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-error-container/30 border border-error/20 text-error text-xs">
                    <span className="material-symbols-outlined text-sm">error</span>{checkInError}
                  </div>
                )}
                {!canCheckIn && <p className="text-xs text-on-surface-variant text-center">Sign in to check in.</p>}
              </div>
            )}
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-5 shadow-ambient border border-outline-variant/10">
            <h3 className="font-bold font-headline text-on-surface mb-3 flex items-center gap-2 text-sm">
              <span className="material-symbols-outlined text-primary text-lg">info</span>
              Event Info
            </h3>
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-on-surface-variant text-xs">Event ID</span>
                <span className="font-mono font-bold text-on-surface text-xs">{event.onChainId || event.eventId || event.id}</span>
              </div>
              {joined && (
                <div className="flex justify-between">
                  <span className="text-on-surface-variant text-xs">Active in Meeting</span>
                  <span className="font-bold text-emerald-600 text-xs flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {participantCount}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-on-surface-variant text-xs">Total Checked In</span>
                <span className="font-bold text-on-surface text-xs">{event.attendeeCount || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant text-xs">Threshold</span>
                <span className="font-bold text-on-surface text-xs">{event.attendanceThreshold || 75}%</span>
              </div>
              {event.joinCode && (
                <div className="flex justify-between">
                  <span className="text-on-surface-variant text-xs">Join Code</span>
                  <span className="font-mono font-bold text-primary text-xs">{event.joinCode}</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-5 shadow-ambient border border-outline-variant/10">
            <h3 className="font-bold font-headline text-on-surface mb-3 flex items-center gap-2 text-sm">
              <span className="material-symbols-outlined text-amber-600 text-lg">emoji_events</span>
              Rewards
            </h3>
            <div className="space-y-2">
              {[
                { icon: "badge", label: "POAP Badge", desc: "Soulbound attendance token" },
                { icon: "workspace_premium", label: "Certificate", desc: "On-chain verification" },
                { icon: "token", label: "VRYF Tokens", desc: "Reward tokens" },
              ].map((r) => (
                <div key={r.label} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-surface-container-low">
                  <span className="material-symbols-outlined text-primary text-base">{r.icon}</span>
                  <div>
                    <p className="text-xs font-bold text-on-surface">{r.label}</p>
                    <p className="text-[10px] text-on-surface-variant">{r.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
