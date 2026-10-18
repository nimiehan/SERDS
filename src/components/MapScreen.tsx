import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  User, 
  PhoneOff, 
  MessageSquare, 
  Shield, 
  Ambulance, 
  Flame, 
  Lock,
  LocateFixed,
  X,
  Send,
  Navigation,
  AlertCircle,
  Phone,
  Radio,
  ChevronLeft
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { io } from 'socket.io-client';
import { 
  calculateRealRoute, 
  formatDistance, 
  formatEta, 
  calculateDistance, 
  RouteResult 
} from '../lib/routing';
import { 
  createEmergencyIncident, 
  fetchOnlineResponders, 
  LiveOnlineResponder,
  sendIncidentMessage,
  fetchIncidentMessages,
  IncidentChatMessage,
  updateIncidentStatus,
  declineEmergencyIncident
} from '../lib/api';
import { useUserSettings } from '../lib/userSettings';
import { useAuth } from '../contexts/AuthContext';
import { 
  subscribeToOnlineResponders, 
  subscribeToIncidentStatus,
  getDirectChatId,
  sendDirectChatMessage,
  subscribeToDirectChatMessages,
  DirectChatMessage
} from '../lib/firebase';

export type EmergencyServiceType = 'police' | 'ambulance' | 'fire';

interface MapScreenProps {
  autoDispatch?: boolean;
  initialIncidentId?: string | null;
  initialService?: EmergencyServiceType;
  initialTargetResponder?: LiveOnlineResponder;
  isGeneralSos?: boolean;
  initialDetails?: string | null;
  onBack?: () => void;
  onCancelDispatch?: () => void;
}

// Citizen Marker on Map
export const createCitizenIcon = (zoom: number) => {
  if (zoom <= 13) {
    return L.divIcon({
      html: `
        <div style="position: relative; display: flex; align-items: center; justify-content: center; transform: translate(-50%, -50%); user-select: none;">
          <span class="animate-ping" style="position: absolute; width: 24px; height: 24px; border-radius: 9999px; background-color: #B41A46; opacity: 0.35;"></span>
          <div style="width: 14px; height: 14px; background-color: #B41A46; border-radius: 9999px; border: 2.5px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>
        </div>
      `,
      className: '',
      iconSize: [26, 26],
      iconAnchor: [0, 0]
    });
  }

  return L.divIcon({
    html: `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-end; transform: translate(-50%, -100%); user-select: none; pointer-events: none;">
        <div style="background-color: #B41A46; color: white; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 800; white-space: nowrap; margin-bottom: 2px; display: flex; align-items: center; gap: 4px; border: 1.5px solid white; box-shadow: 0 2px 8px rgba(180,26,70,0.4);">
          <span style="width: 6px; height: 6px; border-radius: 9999px; background-color: white;" class="animate-pulse"></span>
          <span>Your Location</span>
        </div>
        <div style="position: relative; display: flex; items-center; justify-content: center;">
          <span class="animate-ping" style="position: absolute; width: 22px; height: 22px; border-radius: 9999px; background-color: #B41A46; opacity: 0.35;"></span>
          <div style="width: 14px; height: 14px; background-color: #B41A46; border-radius: 9999px; border: 2.5px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>
        </div>
      </div>
    `,
    className: '',
    iconSize: [110, 50],
    iconAnchor: [0, 0]
  });
};

// Dynamic Live Responder Marker on Map
export const createResponderMarkerIcon = (
  responder: LiveOnlineResponder, 
  isSelected: boolean,
  zoom: number
) => {
  const isPolice = responder.apparatus === 'police';
  const isFire = responder.apparatus === 'fire';
  const emoji = isPolice ? '🚓' : isFire ? '🚒' : '🚑';
  const themeColor = isPolice ? '#2563eb' : isFire ? '#d97706' : '#B41A46';

  if (zoom <= 13) {
    return L.divIcon({
      html: `
        <div style="position: relative; display: flex; align-items: center; justify-content: center; transform: translate(-50%, -50%); user-select: none;">
          ${isSelected ? `<span class="animate-ping" style="position: absolute; width: 26px; height: 26px; border-radius: 9999px; background-color: ${themeColor}; opacity: 0.35;"></span>` : ''}
          <div style="width: 14px; height: 14px; border-radius: 9999px; border: 2px solid white; background-color: ${themeColor}; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>
        </div>
      `,
      className: '',
      iconSize: [24, 24],
      iconAnchor: [0, 0]
    });
  }

  return L.divIcon({
    html: `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-end; transform: translate(-50%, -100%); user-select: none;">
        <div style="background-color: ${isSelected ? '#0a0a0a' : '#ffffff'}; color: ${isSelected ? '#ffffff' : '#171717'}; padding: 2px 7px; border-radius: 8px; font-size: 10px; font-weight: 800; white-space: nowrap; margin-bottom: 3px; display: flex; align-items: center; gap: 4px; border: 1.5px solid ${isSelected ? themeColor : '#e5e5e5'}; box-shadow: 0 4px 12px rgba(0,0,0,0.18);">
          <span style="font-size: 11px;">${emoji}</span>
          <span>${responder.callSign}</span>
        </div>
        <div style="position: relative; display: flex; align-items: center; justify-content: center;">
          ${isSelected ? `<span class="animate-ping" style="position: absolute; width: 22px; height: 22px; border-radius: 9999px; background-color: ${themeColor}; opacity: 0.4;"></span>` : ''}
          <div style="width: 14px; height: 14px; border-radius: 9999px; border: 2.5px solid white; background-color: ${themeColor}; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>
        </div>
      </div>
    `,
    className: '',
    iconSize: [140, 52],
    iconAnchor: [0, 0]
  });
};

// Play audio alert tone
function playChime(freq1 = 587.33, freq2 = 880) {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq1, ctx.currentTime);
    osc.frequency.setValueAtTime(freq2, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.38);
  } catch {}
}

function MapAutoCenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.panTo(center, { animate: true, duration: 0.8 });
  }, [center, map]);
  return null;
}

export default function MapScreen({ 
  autoDispatch, 
  initialIncidentId, 
  initialService, 
  initialTargetResponder, 
  isGeneralSos, 
  initialDetails,
  onBack, 
  onCancelDispatch 
}: MapScreenProps) {
  const { currentUser, userProfile } = useAuth();
  const { settings, updateLocation } = useUserSettings();
  const { location, profile } = settings;

  const hasAutoDispatchedRef = useRef<boolean>(false);
  const isCancelledRef = useRef<boolean>(false);
  const [isGeneralSosMode, setIsGeneralSosMode] = useState<boolean>(Boolean(isGeneralSos));

  // Real Citizen Device Location
  const [citizenLocation, setCitizenLocation] = useState<[number, number] | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = sessionStorage.getItem('serd_real_user_location') || localStorage.getItem('serd_real_user_location');
        if (cached) return JSON.parse(cached);
      } catch {}
    }
    if (location?.lastKnownCoords?.lat && location?.lastKnownCoords?.lng) {
      return [location.lastKnownCoords.lat, location.lastKnownCoords.lng];
    }
    return null;
  });

  const [userStreetAddress, setUserStreetAddress] = useState<string>(location?.lastKnownAddress || '');
  const [mapZoom, setMapZoom] = useState(15);
  const [isLocating, setIsLocating] = useState(false);

  // Real Online Responders Synced from Backend / Responder Mobile UI
  const [onlineResponders, setOnlineResponders] = useState<LiveOnlineResponder[]>([]);

  // Selected Service Filter: Ambulance, Police, Fire
  const [selectedService, setSelectedService] = useState<EmergencyServiceType>(
    initialTargetResponder?.apparatus || initialService || 'ambulance'
  );

  // Active Dispatch State
  const [isDispatched, setIsDispatched] = useState<boolean>(Boolean(initialIncidentId));
  const [dispatchedResponder, setDispatchedResponder] = useState<LiveOnlineResponder | null>(
    initialTargetResponder || null
  );
  const [activeIncidentId, setActiveIncidentId] = useState<string | null>(initialIncidentId || null);
  const [incidentStatus, setIncidentStatus] = useState<string>('dispatched');
  const [calling911, setCalling911] = useState<boolean>(false);

  // Active refs to guard async socket and Firestore events against stale closures
  const activeIncidentIdRef = useRef<string | null>(activeIncidentId);
  useEffect(() => {
    activeIncidentIdRef.current = activeIncidentId;
  }, [activeIncidentId]);

  const isDispatchedRef = useRef<boolean>(isDispatched);
  useEffect(() => {
    isDispatchedRef.current = isDispatched;
  }, [isDispatched]);

  const citizenLocationRef = useRef<[number, number] | null>(citizenLocation);
  useEffect(() => {
    citizenLocationRef.current = citizenLocation;
  }, [citizenLocation]);

  // Two-way messaging with responder
  const [selectedResponder, setSelectedResponder] = useState<LiveOnlineResponder | null>(
    initialTargetResponder || null
  );
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);

  // Synchronize initial target responder or SOS flag if updated
  useEffect(() => {
    if (initialTargetResponder) {
      setSelectedResponder(initialTargetResponder);
      setDispatchedResponder(initialTargetResponder);
      if (initialTargetResponder.apparatus) {
        setSelectedService(initialTargetResponder.apparatus);
      }
    }
    if (isGeneralSos !== undefined) {
      setIsGeneralSosMode(Boolean(isGeneralSos));
    }
  }, [initialTargetResponder, isGeneralSos]);

  // Active target responder: prioritized explicit selection, dispatched unit, or active field unit
  const activeTargetResponder = useMemo<LiveOnlineResponder | null>(() => {
    if (dispatchedResponder) return dispatchedResponder;
    if (selectedResponder) return selectedResponder;
    const matching = onlineResponders.filter(r => r.apparatus === selectedService && r.status !== 'offline');
    if (matching.length > 0) return matching[0];
    if (onlineResponders.length > 0) return onlineResponders[0];
    return null;
  }, [dispatchedResponder, selectedResponder, onlineResponders, selectedService]);

  const [messages, setMessages] = useState<IncidentChatMessage[]>([]);
  const [unreadMsgCount, setUnreadMsgCount] = useState<number>(0);
  const [dispatchStatusToast, setDispatchStatusToast] = useState<{
    type: 'accepted' | 'reassigned' | 'alert';
    message: string;
    subtext?: string;
  } | null>(null);

  // Route calculation
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [routePoints, setRoutePoints] = useState<[number, number][]>([]);

  const [showMessageModal, setShowMessageModal] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [messageSentToast, setMessageSentToast] = useState(false);

  // User's real name from Auth or Profile
  const citizenName = useMemo(() => {
    return userProfile?.fullName || currentUser?.displayName || (profile?.fullName ? profile.fullName : 'Citizen Caller');
  }, [userProfile, currentUser, profile]);

  // Real-time Direct Chat messages (independent of 911 dispatch)
  const [directMessages, setDirectMessages] = useState<DirectChatMessage[]>([]);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const activeChatId = useMemo(() => {
    if (!activeTargetResponder) return null;
    const citizenUid = currentUser?.uid || 'citizen_caller';
    return getDirectChatId(citizenUid, activeTargetResponder.id);
  }, [currentUser?.uid, activeTargetResponder]);

  // Smooth auto-scroll chat to latest message
  useEffect(() => {
    if (showMessageModal && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [directMessages, messages, showMessageModal]);

  // Subscribe to direct chat messages with selected responder in real time
  useEffect(() => {
    if (!activeChatId) {
      setDirectMessages([]);
      return;
    }
    const unsub = subscribeToDirectChatMessages(activeChatId, (msgs) => {
      setDirectMessages(msgs);
      if (msgs.length > 0) {
        const latest = msgs[msgs.length - 1];
        if (latest.senderRole === 'responder' && !showMessageModal) {
          setUnreadMsgCount(c => c + 1);
          playChime(880, 1174.66);
        }
      }
    });
    return () => unsub();
  }, [activeChatId, showMessageModal]);

  // 1. Acquire Real GPS & Reverse Geocode
  const requestLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setCitizenLocation(coords);
        setIsLocating(false);

        try {
          sessionStorage.setItem('serd_real_user_location', JSON.stringify(coords));
          localStorage.setItem('serd_real_user_location', JSON.stringify(coords));
        } catch {}

        // Fetch responders situated relative to this user's real GPS
        fetchOnlineResponders(coords).then(list => {
          if (list && list.length > 0) setOnlineResponders(list);
        });

        // Real reverse geocoding via OpenStreetMap Nominatim
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${coords[0]}&lon=${coords[1]}&format=json`)
          .then(res => res.json())
          .then(data => {
            if (data?.display_name) {
              const parts = data.display_name.split(', ');
              const concise = parts.slice(0, 3).join(', ');
              setUserStreetAddress(concise);
              updateLocation({
                lastKnownCoords: { lat: coords[0], lng: coords[1] },
                lastKnownAddress: concise
              });
            }
          })
          .catch(() => {
            const fallbackAddr = `Lat ${coords[0].toFixed(4)}, Lng ${coords[1].toFixed(4)}`;
            setUserStreetAddress(fallbackAddr);
            updateLocation({
              lastKnownCoords: { lat: coords[0], lng: coords[1] },
              lastKnownAddress: fallbackAddr
            });
          });
      },
      () => {
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  useEffect(() => {
    requestLocation();
  }, []);

  // 2. Fetch and Subscribe to Real Online Responders (Multi-Device via Firestore + Socket + REST)
  useEffect(() => {
    let isSubscribed = true;

    const mergeRespondersList = (baseList: LiveOnlineResponder[]) => {
      const combinedMap = new Map<string, LiveOnlineResponder>();
      baseList.forEach(r => {
        if (r && r.id && r.status !== 'offline') combinedMap.set(r.id, r);
      });

      try {
        const localCached = localStorage.getItem('serd_latest_online_responder');
        if (localCached) {
          const parsed = JSON.parse(localCached);
          if (parsed && parsed.id && parsed.status !== 'offline') {
            const age = Date.now() - (parsed.timestamp || 0);
            if (age < 600000) {
              combinedMap.set(parsed.id, { ...(combinedMap.get(parsed.id) || {}), ...parsed });
            }
          }
        }
      } catch {}

      return Array.from(combinedMap.values());
    };

    // 1. Real-time Firestore Cloud Subscription (Works across all devices & browsers)
    const unsubscribeFirestore = subscribeToOnlineResponders((firestoreFleet) => {
      if (isSubscribed && firestoreFleet) {
        setOnlineResponders(prev => {
          const merged = new Map<string, LiveOnlineResponder>();
          prev.forEach(r => {
            if (r.status !== 'offline') merged.set(r.id, r);
          });
          firestoreFleet.forEach(r => {
            if (r.status === 'offline') {
              merged.delete(r.id);
            } else {
              merged.set(r.id, {
                id: r.id,
                callSign: r.callSign,
                apparatus: r.apparatus,
                status: r.status as any,
                coords: r.coords,
                accuracy: r.accuracy,
                phone: r.phone,
                lastSeen: r.lastSeen
              });
            }
          });
          return mergeRespondersList(Array.from(merged.values()));
        });
      }
    });

    // 2. HTTP Fallback Polling
    const fetchFleet = () => {
      fetchOnlineResponders(citizenLocation || undefined).then(list => {
        if (isSubscribed && list) {
          setOnlineResponders(prev => {
            const map = new Map<string, LiveOnlineResponder>();
            prev.forEach(r => map.set(r.id, r));
            list.forEach(r => {
              if (r.status !== 'offline') map.set(r.id, r);
            });
            return mergeRespondersList(Array.from(map.values()));
          });
        }
      });
    };

    fetchFleet();
    const interval = setInterval(fetchFleet, 3000);

    const handleFocusOrVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchFleet();
      }
    };

    document.addEventListener('visibilitychange', handleFocusOrVisibility);
    window.addEventListener('focus', handleFocusOrVisibility);

    // 3. Socket.io Real-time Push
    const socket = io();
    socket.on('responders-sync', (fleet: LiveOnlineResponder[]) => {
      if (isSubscribed && fleet) {
        setOnlineResponders(prev => {
          const map = new Map<string, LiveOnlineResponder>();
          prev.forEach(r => map.set(r.id, r));
          fleet.forEach(r => {
            if (r.status !== 'offline') map.set(r.id, r);
          });
          return mergeRespondersList(Array.from(map.values()));
        });
      }
    });

    return () => {
      isSubscribed = false;
      unsubscribeFirestore();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleFocusOrVisibility);
      window.removeEventListener('focus', handleFocusOrVisibility);
      socket.disconnect();
    };
  }, [citizenLocation]);

  // Auto-switch service if currently selected service has 0 units but another has online units
  useEffect(() => {
    if (isDispatched) return;
    if (onlineResponders.length > 0) {
      const currentHasAny = onlineResponders.some(r => r.apparatus === selectedService && r.status !== 'offline');
      if (!currentHasAny) {
        const firstActive = onlineResponders.find(r => r.status !== 'offline');
        if (firstActive) {
          setSelectedService(firstActive.apparatus);
        }
      }
    }
  }, [onlineResponders, selectedService, isDispatched]);

  // Find active online responder matching selected service (null if none online)
  const nearestMatchingResponder = useMemo<LiveOnlineResponder | null>(() => {
    const matching = onlineResponders.filter(r => r.apparatus === selectedService && r.status !== 'offline');
    if (matching.length > 0) {
      if (!citizenLocation) return matching[0];
      return matching.reduce((prev, curr) => {
        const dPrev = calculateDistance(citizenLocation[0], citizenLocation[1], prev.coords[0], prev.coords[1]);
        const dCurr = calculateDistance(citizenLocation[0], citizenLocation[1], curr.coords[0], curr.coords[1]);
        return dCurr < dPrev ? curr : prev;
      });
    }
    return null;
  }, [onlineResponders, selectedService, citizenLocation]);

  const currentResponder = activeTargetResponder || nearestMatchingResponder;

  // Calculate live road route whenever responder or citizen coords update during dispatch
  useEffect(() => {
    if (!citizenLocation || !isDispatched) return;
    const activeResp = dispatchedResponder || currentResponder;
    if (activeResp?.coords) {
      calculateRealRoute(activeResp.coords, citizenLocation)
        .then(res => {
          setRouteResult(res);
          setRoutePoints(res.coordinates);
        })
        .catch(() => {});
    } else {
      setRouteResult(null);
      setRoutePoints([]);
    }
  }, [citizenLocation, isDispatched, dispatchedResponder, currentResponder]);

  // Trigger dispatch to real emergency backend
  const triggerDispatch = async (respToUse?: LiveOnlineResponder | null) => {
    // REQUIREMENT: Cannot dispatch when no responder is online
    if (onlineResponders.length === 0) {
      setSelectionNotice('Cannot dispatch: No emergency responders are currently online.');
      return null;
    }
    if (!citizenLocation) {
      setSelectionNotice('Locating your position... Please standby.');
      return null;
    }

    // REQUIREMENT: Only the selected responder can be dispatched
    const target = respToUse !== undefined 
      ? respToUse 
      : selectedResponder;

    if (!target) {
      setSelectionNotice('Please select an online responder unit to dispatch.');
      return null;
    }

    setDispatchedResponder(target);
    setSelectedResponder(target);
    if (target.apparatus) {
      setSelectedService(target.apparatus);
    }
    setIsDispatched(true);
    playChime(659.25, 880);

    const targetDetails = initialDetails || `Dispatched: ${target.callSign} (${target.apparatus.toUpperCase()})`;

    const created = await createEmergencyIncident({
      type: isGeneralSosMode ? 'Emergency SOS Alert' : `Emergency Dispatch - ${target.apparatus.toUpperCase()}`,
      location: userStreetAddress || `Coordinates [${citizenLocation[0].toFixed(4)}, ${citizenLocation[1].toFixed(4)}]`,
      patientName: citizenName,
      priority: 'critical',
      service: target.apparatus,
      targetResponderId: target.id,
      recommendedUnit: target.callSign,
      coords: citizenLocation,
      details: targetDetails,
      isGeneralSos: isGeneralSosMode
    });

    if (created?.id) {
      setActiveIncidentId(created.id);

      // Automatically message whoever is being dispatched with what's wrong from triage
      const triageMessageText = initialDetails
        ? initialDetails
        : `🚨 Emergency dispatch activated for ${target.callSign}. Citizen: ${citizenName}. Location: ${userStreetAddress || 'GPS Location'}.`;

      sendIncidentMessage(created.id, {
        sender: 'citizen',
        senderName: citizenName,
        text: triageMessageText,
        isUrgent: true
      }).catch(err => console.warn('[Incident Msg Notice]:', err));

      const citUid = currentUser?.uid || 'citizen_caller';
      const directChatId = getDirectChatId(citUid, target.id);
      sendDirectChatMessage(directChatId, {
        senderId: citUid,
        senderName: citizenName,
        senderRole: 'citizen',
        text: triageMessageText,
        citizenId: citUid,
        citizenName: citizenName,
        responderId: target.id,
        responderName: target.callSign,
        responderApparatus: target.apparatus
      }).catch(err => console.warn('[Direct Msg Notice]:', err));
    }

    if (target?.coords) {
      calculateRealRoute(target.coords, citizenLocation)
        .then(res => {
          setRouteResult(res);
          setRoutePoints(res.coordinates);
        })
        .catch(() => {});
    }

    return created;
  };

  // Auto-dispatch if requested and not already active
  useEffect(() => {
    if (autoDispatch && !hasAutoDispatchedRef.current && !isCancelledRef.current && !isDispatched && !activeIncidentId && citizenLocation) {
      if (onlineResponders.length === 0) {
        setSelectionNotice('Cannot dispatch: No emergency responders are currently online.');
        return;
      }
      hasAutoDispatchedRef.current = true;
      triggerDispatch(initialTargetResponder || selectedResponder);
    }
  }, [autoDispatch, isDispatched, activeIncidentId, citizenLocation, onlineResponders.length, initialTargetResponder, selectedResponder]);

  // Synchronize initialIncidentId if passed dynamically
  useEffect(() => {
    if (initialIncidentId && !isCancelledRef.current) {
      setActiveIncidentId(initialIncidentId);
      setIsDispatched(true);
    }
  }, [initialIncidentId]);

  const trigger911Call = (serviceName?: string) => {
    playChime(440, 330);
    setCalling911(true);
    try {
      window.location.href = 'tel:911';
    } catch (err) {
      console.error('Failed to trigger tel:911', err);
    }
    setIsDispatched(false);
    setActiveIncidentId(null);
    setDispatchedResponder(null);
    setRouteResult(null);
    setRoutePoints([]);
    setDispatchStatusToast({
      type: 'alert',
      message: 'No Responders Available — Calling 911',
      subtext: `All ${serviceName ? serviceName.toUpperCase() : 'emergency'} units are unavailable or declined. Connecting directly to 911.`
    });
  };

  // Real-time synchronization of incident status & messages with responder mobile
  useEffect(() => {
    if (!activeIncidentId) return;

    fetchIncidentMessages(activeIncidentId).then(list => {
      if (list && list.length > 0) setMessages(list);
    });

    const isMatch = (incId?: string) => {
      if (!incId) return isDispatchedRef.current;
      if (!activeIncidentIdRef.current) return isDispatchedRef.current;
      const cur = String(activeIncidentIdRef.current).toLowerCase();
      const incoming = String(incId).toLowerCase();
      return cur === incoming || cur.includes(incoming) || incoming.includes(cur);
    };

    // Real-time Firestore Incident Lifecycle Subscription (Cross-device sync)
    const unsubscribeIncident = subscribeToIncidentStatus(activeIncidentId, (inc) => {
      if (inc && inc.status) {
        setIncidentStatus(inc.status);
        if (inc.status === 'en_route') {
          playChime(784, 1046.5);
          const assignedResp: LiveOnlineResponder = {
            id: inc.targetResponderId || inc.acceptedUnit || 'responder',
            callSign: inc.acceptedUnit || inc.recommendedUnit || 'Assigned Unit',
            apparatus: (inc.service as any) || 'ambulance',
            coords: (inc.coords as [number, number]) || [14.5995, 120.9842],
            status: 'en_route'
          };
          setDispatchedResponder(assignedResp);
          setSelectedResponder(assignedResp);
          if (assignedResp.coords && citizenLocationRef.current) {
            calculateRealRoute(assignedResp.coords, citizenLocationRef.current)
              .then(res => {
                setRouteResult(res);
                setRoutePoints(res.coordinates);
              })
              .catch(() => {});
          }
          setDispatchStatusToast({
            type: 'accepted',
            message: `Unit ${assignedResp.callSign} Accepted!`,
            subtext: 'The emergency unit has responded to your call and is en route to your location.'
          });
          setTimeout(() => setDispatchStatusToast(null), 7000);
        } else if (inc.status === 'dispatched' && inc.targetResponderId && dispatchedResponder && inc.targetResponderId !== dispatchedResponder.id) {
          playChime(587.33, 440);
          const newUnit: LiveOnlineResponder = {
            id: inc.targetResponderId,
            callSign: inc.recommendedUnit || 'Next Unit',
            apparatus: (inc.service as any) || selectedService,
            coords: (inc.coords as [number, number]) || [14.5995, 120.9842],
            status: 'waiting'
          };
          setDispatchedResponder(newUnit);
          setSelectedResponder(newUnit);
          if (inc.service) setSelectedService(inc.service as any);
          setDispatchStatusToast({
            type: 'reassigned',
            message: 'Incident Reassigned',
            subtext: `Auto-calling next available unit: ${inc.recommendedUnit}...`
          });
          setTimeout(() => setDispatchStatusToast(null), 8000);
        } else if (inc.status === 'cancelled') {
          if (inc.details?.includes('declined') || inc.details?.includes('911')) {
            trigger911Call(inc.service);
          } else {
            setIsDispatched(false);
            setActiveIncidentId(null);
            setDispatchedResponder(null);
            setRouteResult(null);
            setRoutePoints([]);
          }
        } else if (inc.status === 'completed') {
          setIsDispatched(false);
          setActiveIncidentId(null);
          setDispatchedResponder(null);
          setRouteResult(null);
          setRoutePoints([]);
        }
      }
    });

    const socket = io();

    // Unit accepted dispatch
    socket.on('incident-accepted', (data: { incidentId: string; status: string; responder: any }) => {
      if (data && isMatch(data.incidentId)) {
        setIncidentStatus('en_route');
        playChime(784, 1046.5);
        if (data.responder) {
          setDispatchedResponder(data.responder);
          setSelectedResponder(data.responder);
          if (data.responder.coords && citizenLocationRef.current) {
            calculateRealRoute(data.responder.coords, citizenLocationRef.current)
              .then(res => {
                setRouteResult(res);
                setRoutePoints(res.coordinates);
              })
              .catch(() => {});
          }
        }
        setDispatchStatusToast({
          type: 'accepted',
          message: `Unit ${data.responder?.callSign || 'Assigned Unit'} Accepted!`,
          subtext: 'The emergency unit has responded to your call and is en route to your location.'
        });
        setTimeout(() => setDispatchStatusToast(null), 7000);
      }
    });

    // Responder unit declined dispatch
    socket.on('incident-declined', (data: any) => {
      if (!data || !isMatch(data.incidentId)) return;
      if (data.nextUnit) {
        playChime(587.33, 440);
        setDispatchedResponder(data.nextUnit);
        setSelectedResponder(data.nextUnit);
        if (data.nextUnit.apparatus) {
          setSelectedService(data.nextUnit.apparatus);
        }
        if (data.nextUnit.coords && citizenLocationRef.current) {
          calculateRealRoute(data.nextUnit.coords, citizenLocationRef.current)
            .then(res => {
              setRouteResult(res);
              setRoutePoints(res.coordinates);
            })
            .catch(() => {});
        }
        setDispatchStatusToast({
          type: 'reassigned',
          message: `Unit ${data.declinedBy || 'Previous Unit'} Unavailable`,
          subtext: `Auto-calling next available ${data.service?.toUpperCase() || ''} unit: ${data.nextUnit.callSign}...`
        });
        setTimeout(() => setDispatchStatusToast(null), 8000);
      } else if (data.allDeclined || data.call911) {
        trigger911Call(data.service);
      }
    });

    // Auto-reassigned when unit declined:
    // - If General SOS: next nearest unit of ANY service
    // - If specific service: next unit in the SAME service
    socket.on('incident-reassigned', (data: { incidentId: string; previousUnit: string; nextUnit: any; service: string; isGeneralSos?: boolean }) => {
      if (data && isMatch(data.incidentId)) {
        playChime(587.33, 440);
        if (data.nextUnit) {
          setDispatchedResponder(data.nextUnit);
          setSelectedResponder(data.nextUnit);
          if (data.nextUnit.apparatus) {
            setSelectedService(data.nextUnit.apparatus);
          }
          if (data.nextUnit.coords && citizenLocationRef.current) {
            calculateRealRoute(data.nextUnit.coords, citizenLocationRef.current)
              .then(res => {
                setRouteResult(res);
                setRoutePoints(res.coordinates);
              })
              .catch(() => {});
          }
        }
        setDispatchStatusToast({
          type: 'reassigned',
          message: `Unit ${data.previousUnit} Unavailable`,
          subtext: data.isGeneralSos
            ? `Auto-calling next nearest unit: ${data.nextUnit?.callSign} (${data.service?.toUpperCase() || ''})...`
            : `Auto-calling next available ${data.service?.toUpperCase() || ''} unit: ${data.nextUnit?.callSign}...`
        });
        setTimeout(() => setDispatchStatusToast(null), 7000);
      }
    });

    // All units declined / occupied -> immediately call 911
    socket.on('incident-declined-all', (data: { incidentId: string; service: string; isGeneralSos?: boolean }) => {
      if (data && isMatch(data.incidentId)) {
        trigger911Call(data.service);
      }
    });

    // Responder status update (dispatched, en_route, on_scene, transporting, completed, cancelled)
    socket.on('incident-updated', (updated: any) => {
      if (updated && isMatch(updated.id)) {
        setIncidentStatus(updated.status);
        playChime(659.25, 880);
        if (updated.status === 'cancelled' || updated.status === 'completed') {
          setIsDispatched(false);
          setActiveIncidentId(null);
          setDispatchedResponder(null);
          setRouteResult(null);
          setRoutePoints([]);
        }
      }
    });

    // Two-way radio messages
    socket.on('incident-message', (data: { incidentId: string; message: IncidentChatMessage }) => {
      if (data && isMatch(data.incidentId)) {
        setMessages(prev => {
          if (prev.some(m => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
        if (data.message.sender !== 'citizen') {
          playChime(880, 1174.66);
          setUnreadMsgCount(c => c + 1);
        }
      }
    });

    // Real-time direct chat message socket push
    socket.on('direct-message', (data: { chatId: string; message: any }) => {
      if (data && data.chatId === activeChatId) {
        setDirectMessages(prev => {
          if (prev.some(m => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
        if (data.message.senderRole !== 'citizen' && !showMessageModal) {
          playChime(880, 1174.66);
          setUnreadMsgCount(c => c + 1);
        }
      }
    });

    return () => {
      unsubscribeIncident();
      socket.disconnect();
    };
  }, [activeIncidentId]);

  const handleCancelDispatch = async () => {
    isCancelledRef.current = true;
    hasAutoDispatchedRef.current = true;
    const incId = activeIncidentId;
    setIsDispatched(false);
    setActiveIncidentId(null);
    setDispatchedResponder(null);
    setRouteResult(null);
    setRoutePoints([]);
    playChime(440, 330);
    if (onCancelDispatch) {
      onCancelDispatch();
    }
    if (incId) {
      await updateIncidentStatus(incId, 'cancelled');
    }
  };

  const handleSendCommsMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const textToSend = chatMessage.trim();
    if (!textToSend || !activeTargetResponder) return;

    const citUid = currentUser?.uid || 'citizen_caller';
    const citName = citizenName || 'Citizen';
    const chatId = activeChatId || getDirectChatId(citUid, activeTargetResponder.id);

    setChatMessage('');
    setMessageSentToast(true);
    setTimeout(() => setMessageSentToast(false), 2000);

    // Send direct message to Firestore & Socket bridge (Clean Direct Message - NEVER creates CAD dispatch)
    await sendDirectChatMessage(chatId, {
      senderId: citUid,
      senderName: citName,
      senderRole: 'citizen',
      text: textToSend,
      citizenId: citUid,
      citizenName: citName,
      responderId: activeTargetResponder.id,
      responderName: activeTargetResponder.callSign,
      responderApparatus: activeTargetResponder.apparatus
    });
  };

  // Estimated distance & ETA
  const estDistanceMeters = (citizenLocation && currentResponder?.coords) ? calculateDistance(
    citizenLocation[0],
    citizenLocation[1],
    currentResponder.coords[0],
    currentResponder.coords[1]
  ) : 0;

  const estDurationSeconds = Math.max(60, Math.round(estDistanceMeters / 12.5));

  return (
    <div className="relative w-full h-[100dvh] bg-[#0F172A] font-sans overflow-hidden select-none">
      
      {/* Fullscreen Map Canvas */}
      <div className="absolute inset-0 z-0">
        {citizenLocation ? (
          <MapContainer
            center={citizenLocation}
            zoom={mapZoom}
            zoomControl={false}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapAutoCenter center={citizenLocation} />

            {/* Real Citizen GPS Marker */}
            <Marker position={citizenLocation} icon={createCitizenIcon(mapZoom)} zIndexOffset={900} />

            {/* Real Online Responders on Map */}
            {onlineResponders.map(resp => {
              const isSelected = activeTargetResponder?.id === resp.id;

              // Ensure coordinates are valid LatLng and not Null Island [0,0]
              const hasRealCoords = Array.isArray(resp.coords) && 
                resp.coords.length === 2 && 
                !isNaN(resp.coords[0]) && 
                !isNaN(resp.coords[1]) && 
                !(resp.coords[0] === 0 && resp.coords[1] === 0);

              const displayCoords: [number, number] = hasRealCoords 
                ? resp.coords 
                : (citizenLocation ? [citizenLocation[0] + 0.005, citizenLocation[1] + 0.005] : [14.5995, 120.9842]);

              return (
                <Marker
                  key={resp.id}
                  position={displayCoords}
                  icon={createResponderMarkerIcon(resp, isSelected, mapZoom)}
                  zIndexOffset={isSelected ? 1000 : 800}
                  eventHandlers={{
                    click: () => {
                      setSelectedResponder({ ...resp, coords: displayCoords });
                      setSelectedService(resp.apparatus);
                      setSelectionNotice(null);
                    }
                  }}
                />
              );
            })}

            {/* Real Road Route Polyline */}
            {isDispatched && routePoints.length > 0 && (
              <Polyline 
                positions={routePoints} 
                color="#B41A46" 
                weight={6} 
                opacity={0.9}
                lineCap="round"
                lineJoin="round"
              />
            )}
          </MapContainer>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-white text-center">
            <LocateFixed className="w-12 h-12 text-[#B41A46] animate-pulse mb-3" />
            <h3 className="font-bold text-base">Locking GPS Coordinates...</h3>
            <p className="text-xs text-neutral-400 mt-1 max-w-xs">
              Connecting directly to your mobile device satellite receiver
            </p>
            <button
              onClick={requestLocation}
              className="mt-4 px-4 py-2 bg-[#B41A46] text-white text-xs font-bold rounded-xl shadow-md cursor-pointer"
            >
              Grant GPS Lock
            </button>
          </div>
        )}
      </div>

      {/* Top Floating Action Bar */}
      <div className="absolute top-3 sm:top-4 left-3 sm:left-4 right-3 sm:right-4 z-20 flex items-center justify-end gap-2.5 pointer-events-none">
        {/* Messages & Patrol Comms Icon Button */}
        <button
          onClick={() => {
            if (activeTargetResponder) {
              setUnreadMsgCount(0);
              setShowMessageModal(true);
            } else if (onlineResponders.length > 0) {
              setSelectedResponder(onlineResponders[0]);
              setUnreadMsgCount(0);
              setShowMessageModal(true);
            } else {
              setSelectionNotice('Select an active patrol unit from the map to open direct radio messaging.');
              setTimeout(() => setSelectionNotice(null), 4000);
            }
          }}
          className="pointer-events-auto relative w-10 h-10 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md rounded-2xl shadow-lg border border-neutral-200/80 dark:border-neutral-800 flex items-center justify-center text-neutral-800 dark:text-white cursor-pointer active:scale-95 transition-all"
          aria-label="Messages"
          title="Direct Radio Messages"
        >
          <MessageSquare className="w-5 h-5 text-neutral-800 dark:text-white" />
          {unreadMsgCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-[#B41A46] text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-md">
              {unreadMsgCount}
            </span>
          )}
        </button>

        <button
          onClick={requestLocation}
          className="pointer-events-auto w-10 h-10 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md rounded-2xl shadow-lg border border-neutral-200/80 dark:border-neutral-800 flex items-center justify-center text-neutral-800 dark:text-white cursor-pointer active:scale-95 transition-all"
          title="Recenter on my GPS"
        >
          <LocateFixed className={`w-5 h-5 ${isLocating ? 'animate-spin text-neutral-400' : 'text-[#B41A46]'}`} />
        </button>
      </div>

      {/* Real-time Dispatch Status Toast / Banner (Accepted, Reassigned, etc.) */}
      {dispatchStatusToast && (
        <div className="absolute top-16 sm:top-20 left-3 sm:left-4 right-3 sm:right-4 z-40 max-w-md mx-auto animate-[fade-in_0.2s_ease-out]">
          <div className={`p-3.5 rounded-2xl shadow-2xl backdrop-blur-md border flex items-start gap-3 ${
            dispatchStatusToast.type === 'accepted'
              ? 'bg-emerald-950/95 border-emerald-500/60 text-white'
              : dispatchStatusToast.type === 'reassigned'
              ? 'bg-amber-950/95 border-amber-500/60 text-white'
              : 'bg-rose-950/95 border-rose-500/60 text-white'
          }`}>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-sm ${
              dispatchStatusToast.type === 'accepted'
                ? 'bg-emerald-600 text-white'
                : dispatchStatusToast.type === 'reassigned'
                ? 'bg-amber-600 text-white'
                : 'bg-rose-600 text-white'
            }`}>
              {dispatchStatusToast.type === 'accepted' ? '✓' : dispatchStatusToast.type === 'reassigned' ? '↻' : '!'}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs sm:text-sm font-extrabold leading-tight">
                {dispatchStatusToast.message}
              </h4>
              {dispatchStatusToast.subtext && (
                <p className="text-[11px] text-neutral-300 mt-0.5 leading-snug">
                  {dispatchStatusToast.subtext}
                </p>
              )}
            </div>
            <button
              onClick={() => setDispatchStatusToast(null)}
              className="text-neutral-400 active:text-white p-1 cursor-pointer text-xs"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Floating Bottom Card: Service Selector & Actions */}
      <div className="absolute bottom-3 sm:bottom-4 left-3 sm:left-4 right-3 sm:right-4 max-w-md mx-auto bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md rounded-2xl shadow-xl border border-gray-100 dark:border-neutral-800 p-4 z-20 animate-[fade-in_0.2s_ease-out]">
        
        {/* Active Responder Identity */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 text-xl ${
              selectedService === 'police'
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400'
                : selectedService === 'fire'
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400'
                : 'bg-rose-50 text-[#B41A46] dark:bg-rose-950/50 dark:text-rose-400'
            }`}>
              {selectedService === 'police' ? '🚓' : selectedService === 'fire' ? '🚒' : '🚑'}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-xs sm:text-sm font-bold text-gray-900 dark:text-white truncate">
                {currentResponder?.callSign || (isDispatched ? 'Field Patrol' : 'No Unit Online')}
              </h3>
              <p className="text-[11px] text-gray-500 dark:text-neutral-400 truncate">
                {isDispatched 
                  ? `Dispatched to ${currentResponder?.callSign || 'Field Patrol'}` 
                  : currentResponder 
                    ? 'Live Field Unit Online' 
                    : `No ${selectedService} unit currently active`}
              </p>
            </div>
          </div>

          <div className="shrink-0 text-right">
            {isDispatched ? (
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-bold transition-all ${
                incidentStatus === 'on_scene'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                  : incidentStatus === 'transporting'
                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                  : incidentStatus === 'en_route'
                  ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400'
                  : 'bg-rose-50 dark:bg-rose-950/40 border-rose-100 dark:border-rose-900/50 text-[#B41A46] dark:text-rose-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                  incidentStatus === 'on_scene' 
                    ? 'bg-emerald-600' 
                    : incidentStatus === 'transporting' 
                    ? 'bg-amber-600' 
                    : incidentStatus === 'en_route' 
                    ? 'bg-blue-600' 
                    : 'bg-[#B41A46]'
                }`} />
                <span>
                  {incidentStatus === 'on_scene' 
                    ? 'ON SCENE' 
                    : incidentStatus === 'transporting' 
                    ? 'TRANSPORTING' 
                    : incidentStatus === 'en_route' 
                    ? (routeResult ? `EN ROUTE • ${formatEta(routeResult.durationSeconds)}` : 'EN ROUTE') 
                    : (routeResult ? `${formatDistance(routeResult.distanceMeters)} • ${formatEta(routeResult.durationSeconds)}` : 'DISPATCHED')}
                </span>
              </div>
            ) : (currentResponder && currentResponder.coords && citizenLocation) ? (
              <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-gray-100 dark:bg-neutral-800 text-gray-800 dark:text-neutral-200 text-xs font-semibold">
                <span className="font-bold">{formatDistance(estDistanceMeters)}</span>
                <span className="text-gray-300 dark:text-neutral-600">&bull;</span>
                <span className="text-[#B41A46] dark:text-rose-400">{formatEta(estDurationSeconds)}</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-gray-100 dark:bg-neutral-800 text-gray-500 dark:text-neutral-400 text-xs font-semibold">
                <span>Offline</span>
              </div>
            )}
          </div>
        </div>

        {/* Emergency Service Selector */}
        <div className="mb-3">
          <div className="flex items-center justify-between text-[11px] mb-1.5">
            <span className="font-bold uppercase tracking-wider text-gray-500 dark:text-neutral-400 text-[10px]">
              Select Service
            </span>
            {isDispatched && (
              <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1">
                <Lock className="w-3 h-3" />
                Unit Dispatched
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={isDispatched}
              onClick={() => setSelectedService('police')}
              className={`py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 ${
                selectedService === 'police'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-neutral-300'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Police</span>
            </button>

            <button
              type="button"
              disabled={isDispatched}
              onClick={() => setSelectedService('ambulance')}
              className={`py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 ${
                selectedService === 'ambulance'
                  ? 'bg-[#B41A46] text-white shadow-xs'
                  : 'bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-neutral-300'
              }`}
            >
              <Ambulance className="w-3.5 h-3.5" />
              <span>Ambulance</span>
            </button>

            <button
              type="button"
              disabled={isDispatched}
              onClick={() => setSelectedService('fire')}
              className={`py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 ${
                selectedService === 'fire'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-neutral-300'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              <span>Fire</span>
            </button>
          </div>
        </div>

        {/* Responder Unit Selector - Required for messaging */}
        <div className="mb-3">
          <div className="flex items-center justify-between text-[11px] mb-1.5">
            <span className="font-bold uppercase tracking-wider text-gray-500 dark:text-neutral-400 text-[10px]">
              Select Responder Unit ({onlineResponders.length})
            </span>
          </div>

          {onlineResponders.length === 0 ? (
            <div className="p-2.5 bg-gray-50 dark:bg-neutral-800/60 rounded-xl border border-gray-200 dark:border-neutral-700 text-center text-xs text-gray-400">
              No field units currently online. Please standby.
            </div>
          ) : (
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
              {onlineResponders.map(r => {
                const isChosen = activeTargetResponder?.id === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setSelectedResponder(r);
                      setSelectedService(r.apparatus);
                      setSelectionNotice(null);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-all shrink-0 cursor-pointer active:scale-95 ${
                      isChosen
                        ? 'bg-[#B41A46] text-white border-[#B41A46] shadow-xs'
                        : 'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-gray-200 dark:border-neutral-700'
                    }`}
                  >
                    <span>{r.apparatus === 'police' ? '🚓' : r.apparatus === 'fire' ? '🚒' : '🚑'}</span>
                    <span className="font-bold truncate max-w-[120px]">{r.callSign}</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${r.status === 'waiting' ? 'bg-emerald-400' : 'bg-blue-400'}`} />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Dual Actions: CALL RESPONDER MOBILE & DISPATCH / MESSAGE */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            disabled={!isDispatched && (onlineResponders.length === 0 || !selectedResponder)}
            onClick={() => {
              if (isDispatched) {
                handleCancelDispatch();
              } else {
                if (onlineResponders.length === 0) {
                  setSelectionNotice('No emergency responders are currently online to dispatch.');
                  return;
                }
                if (!selectedResponder) {
                  setSelectionNotice('Please select an online responder unit before dispatching.');
                  return;
                }
                triggerDispatch(selectedResponder);
              }
            }}
            className={`py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-xs ${
              isDispatched
                ? 'bg-neutral-900 text-neutral-300 border border-neutral-700 cursor-pointer active:scale-95'
                : (onlineResponders.length === 0 || !selectedResponder)
                ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-500 cursor-not-allowed opacity-60'
                : 'bg-[#B41A46] text-white cursor-pointer active:scale-95'
            }`}
          >
            {isDispatched ? <X className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
            <span>
              {isDispatched 
                ? 'CANCEL DISPATCH' 
                : onlineResponders.length === 0 
                ? 'NO RESPONDERS ONLINE' 
                : !selectedResponder
                ? 'SELECT UNIT TO DISPATCH'
                : `DISPATCH ${selectedResponder.callSign.toUpperCase()}`}
            </span>
          </button>

          <button
            type="button"
            disabled={!activeTargetResponder}
            onClick={() => {
              if (!activeTargetResponder) {
                setSelectionNotice('No active patrol unit is currently online to message.');
                return;
              }
              setSelectionNotice(null);
              setUnreadMsgCount(0);
              setShowMessageModal(true);
            }}
            className={`relative py-3 rounded-xl border font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-xs active:scale-95 ${
              activeTargetResponder
                ? 'bg-white dark:bg-neutral-900 border-[#B41A46] text-[#B41A46] dark:text-rose-400 cursor-pointer'
                : 'bg-gray-100 dark:bg-neutral-800 border-gray-200 dark:border-neutral-700 text-gray-400 dark:text-neutral-500 cursor-not-allowed opacity-60'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>
              {activeTargetResponder 
                ? `MESSAGE ${activeTargetResponder.callSign.toUpperCase()}`
                : 'NO PATROL ONLINE'}
            </span>
            {unreadMsgCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-[#B41A46] text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-md">
                {unreadMsgCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Selection Notice Toast */}
      {selectionNotice && (
        <div className="absolute top-4 left-4 right-4 z-40 bg-amber-500 text-white rounded-2xl p-3.5 shadow-xl flex items-center justify-between text-xs font-bold animate-[fade-in_0.2s_ease-out]">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{selectionNotice}</span>
          </div>
          <button onClick={() => setSelectionNotice(null)} className="ml-2 font-bold px-1.5 py-0.5 rounded active:bg-amber-600">✕</button>
        </div>
      )}

      {/* Message Modal with Real Live Chat Thread */}
      {showMessageModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-[fade-in_0.15s_ease-out]">
          <div className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white rounded-t-[28px] sm:rounded-3xl w-full sm:max-w-md shadow-2xl border-t sm:border border-neutral-200/80 dark:border-neutral-800 flex flex-col h-[75vh] max-h-[620px] overflow-hidden">
            
            {/* Mobile handle */}
            <div className="w-10 h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full mx-auto mt-2.5 sm:hidden shrink-0" />

            {/* Minimal Header */}
            <div className="px-5 py-3.5 border-b border-neutral-100 dark:border-neutral-800/80 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-rose-50 dark:bg-rose-950/40 text-[#B41A46] dark:text-rose-400 flex items-center justify-center text-sm shrink-0 border border-rose-100 dark:border-rose-900/40">
                  {activeTargetResponder?.apparatus === 'police' ? '🚓' : activeTargetResponder?.apparatus === 'fire' ? '🚒' : '🚑'}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-white truncate">
                    {activeTargetResponder?.callSign || 'Emergency Unit'}
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate flex items-center gap-1.5 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shrink-0" />
                    <span>Live Channel</span>
                    {activeTargetResponder && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{formatDistance(estDistanceMeters)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatEta(estDurationSeconds)}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {activeTargetResponder?.phone && (
                  <a
                    href={`tel:${activeTargetResponder.phone}`}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400 active:bg-emerald-50 dark:active:bg-emerald-950/50 transition-colors"
                    title="Call Unit"
                  >
                    <Phone className="w-4 h-4" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setShowMessageModal(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-400 active:text-neutral-700 dark:active:text-white transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Minimal Message Canvas */}
            <div 
              ref={chatScrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-neutral-50/60 dark:bg-neutral-950/40"
            >
              {directMessages.length === 0 && messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-neutral-400">
                  <div className="w-9 h-9 rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-neutral-400 flex items-center justify-center mb-2">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    Direct Radio Comms Link
                  </p>
                  <p className="text-[11px] text-neutral-400 mt-1 max-w-xs leading-relaxed">
                    Send gate codes, entrance notes, or patient status changes directly to {activeTargetResponder?.callSign || 'this unit'}.
                  </p>
                </div>
              ) : (
                (directMessages.length > 0 ? directMessages : messages).map((m: any) => {
                  const isCitizen = m.senderRole ? m.senderRole === 'citizen' : m.sender === 'citizen';
                  return (
                    <div key={m.id} className={`flex flex-col ${isCitizen ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-neutral-400">
                        <span>{isCitizen ? 'You' : m.senderName}</span>
                        <span aria-hidden="true">·</span>
                        <span>{m.timestamp}</span>
                      </div>
                      <div
                        className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-xs font-normal leading-relaxed shadow-xs ${
                          isCitizen
                            ? 'bg-[#B41A46] text-white rounded-br-xs'
                            : 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border border-neutral-200/80 dark:border-neutral-700/80 rounded-bl-xs'
                        }`}
                      >
                        {m.text}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Minimal Composer */}
            <form 
              onSubmit={handleSendCommsMessage}
              className="p-3 border-t border-neutral-100 dark:border-neutral-800/80 bg-white dark:bg-neutral-900 flex items-center gap-2 shrink-0"
            >
              <input
                type="text"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                placeholder={`Message ${activeTargetResponder?.callSign || 'unit'}...`}
                className="flex-1 px-4 py-2.5 bg-neutral-100 dark:bg-neutral-800 border border-transparent focus:border-[#B41A46] focus:bg-white dark:focus:bg-neutral-900 rounded-full text-xs font-normal text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none transition-all"
              />
              <button
                type="submit"
                disabled={!chatMessage.trim()}
                className="w-9 h-9 bg-[#B41A46] disabled:opacity-30 text-white rounded-full flex items-center justify-center transition-all shrink-0 cursor-pointer active:scale-95 shadow-xs"
                title="Send"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 911 Emergency Auto-Calling Modal */}
      {calling911 && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-[fade-in_0.15s_ease-out]">
          <div className="bg-white dark:bg-neutral-900 rounded-3xl p-6 w-full max-w-sm text-center shadow-2xl border border-rose-100 dark:border-rose-950 flex flex-col items-center">
            <div className="w-16 h-16 rounded-full bg-rose-100 dark:bg-rose-950/60 text-[#B41A46] dark:text-rose-400 flex items-center justify-center mb-4 animate-pulse">
              <Phone className="w-8 h-8 fill-current" />
            </div>
            <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-1">Calling 911</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-6 leading-relaxed">
              All {selectedService ? selectedService.toUpperCase() : 'emergency'} units are unavailable or have declined. Emergency phone call to 911 dispatch has been placed.
            </p>
            <div className="flex flex-col w-full gap-2.5">
              <a
                href="tel:911"
                className="w-full py-3.5 rounded-2xl bg-[#B41A46] text-white font-bold text-sm tracking-wide shadow-lg shadow-rose-900/20 active:scale-95 transition-all text-center flex items-center justify-center gap-2"
              >
                <Phone className="w-4 h-4 fill-current" />
                <span>Call 911 Now</span>
              </a>
              <button
                type="button"
                onClick={() => setCalling911(false)}
                className="w-full py-2.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 font-semibold text-xs active:bg-neutral-200 dark:active:bg-neutral-700 transition-all cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
