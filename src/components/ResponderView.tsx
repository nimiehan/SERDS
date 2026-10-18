import React, { useState, useEffect, useRef, useMemo } from'react';
import { 
 LogOut, 
 MapPin, 
 Phone, 
 AlertTriangle, 
 Check, 
 Shield, 
 CornerUpRight, 
 ChevronRight, 
 ChevronLeft,
 Heart,
 MessageSquare,
 Send,
 Radio,
 Navigation,
 Bell,
 Flame,
 Siren,
 Stethoscope,
 X,
 RefreshCw,
 LocateFixed,
 Layers,
 Search,
 ArrowLeft,
 User
} from'lucide-react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from'react-leaflet';
import L from'leaflet';
import { io, Socket } from'socket.io-client';
import { 
 calculateRealRoute, 
 calculateDistance,
 formatDistance, 
 formatEta, 
 RouteResult 
} from'../lib/routing';
import { GpsFilter } from'../lib/gpsFilter';
import { useAuth } from'../contexts/AuthContext';
import { useUserSettings } from'../lib/userSettings';
import { 
 subscribeToIncidents, 
 updateFirestoreIncidentStatus, 
 syncResponderPresenceToFirestore,
 subscribeToDirectChatsForResponder,
 subscribeToDirectChatMessages,
 sendDirectChatMessage,
 getDirectChatId,
 subscribeToOnlineResponders,
 DirectChat,
 DirectChatMessage,
 FirestoreIncident 
} from'../lib/firebase';
import { 
 fetchIncidents, 
 updateIncidentStatus, 
 fetchIncidentMessages, 
 sendIncidentMessage, 
 IncidentChatMessage,
 syncResponderPresence,
 declineEmergencyIncident,
 LiveOnlineResponder
} from'../lib/api';

interface ResponderViewProps {
 onBack: () => void;
}

type ResponderMode ='offline' |'waiting' |'incoming' |'en_route' |'on_scene' |'transporting';
type ApparatusType ='ambulance' |'police' |'fire';

// Dynamic Leaflet Marker Icon generator based on Apparatus (Police, Ambulance, Fire Engine)
function createVehicleIcon(type: ApparatusType, callSign: string) {
 const iconEmoji = type ==='police' ?'🚓' : type ==='fire' ?'🚒' :'🚑';
 const badgeBg = type ==='police' 
 ?'background: #2563eb; border-color: #60a5fa;' 
 : type ==='fire' 
 ?'background: #d97706; border-color: #fbbf24;' 
 :'background: #B41A46; border-color: #fb7185;';
 const pingColor = type ==='police' ?'#3b82f6' : type ==='fire' ?'#f59e0b' :'#f43f5e';

 return L.divIcon({
 html:`
 <div style="position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; transform: translate(-50%, -50%); user-select: none;">
 <span class="animate-ping" style="position: absolute; width: 44px; height: 44px; border-radius: 9999px; opacity: 0.3; background-color: ${pingColor};"></span>
 <div style="${badgeBg} position: relative; width: 42px; height: 42px; border-radius: 14px; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 25px rgba(0,0,0,0.4); border: 2.5px solid white; font-size: 20px;">
 ${iconEmoji}
 </div>
 <div style="margin-top: 4px; padding: 2px 7px; border-radius: 6px; background-color: rgba(10,10,10,0.92); color: white; font-family: ui-monospace, monospace; font-size: 10px; font-weight: 800; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.25);">
 ${callSign}
 </div>
 </div>
`,
 className:'',
 iconSize: [42, 60],
 iconAnchor: [0, 0]
 });
}

function createIncidentMarkerIcon(patientName: string) {
 return L.divIcon({
 html:`
 <div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; user-select: none; pointer-events: none; transform: translate(-50%, -100%);">
 <div style="background-color: #e11d48; color: white; padding: 3px 9px; border-radius: 8px; box-shadow: 0 4px 12px rgba(225,29,72,0.4); font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; display: flex; items-center; gap: 4px; border: 1.5px solid white; white-space: nowrap;">
 <span style="width: 6px; height: 6px; border-radius: 9999px; background-color: white;" class="animate-ping"></span>
 <span>${patientName ||'Emergency Scene'}</span>
 </div>
 <div style="width: 14px; height: 14px; background-color: #e11d48; border-radius: 9999px; box-shadow: 0 2px 6px rgba(0,0,0,0.4); border: 2.5px solid white;"></div>
 </div>
`,
 className:'',
 iconSize: [120, 52],
 iconAnchor: [0, 0]
 });
}

function createDropoffMarkerIcon(destinationName: string) {
 return L.divIcon({
 html:`
 <div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; user-select: none; pointer-events: none; transform: translate(-50%, -100%);">
 <div style="background-color: #2563eb; color: white; padding: 3px 9px; border-radius: 8px; box-shadow: 0 4px 12px rgba(37,99,235,0.4); font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; border: 1.5px solid white; white-space: nowrap;">
 📍 ${destinationName ||'Drop-off Location'}
 </div>
 <div style="width: 14px; height: 14px; background-color: #2563eb; border-radius: 9999px; box-shadow: 0 2px 6px rgba(0,0,0,0.4); border: 2.5px solid white;"></div>
 </div>
`,
 className:'',
 iconSize: [140, 52],
 iconAnchor: [0, 0]
 });
}

// Map Click Listener to pick custom drop-off point anywhere on map
function MapLocationPicker({ onSelect, active }: { onSelect: (coords: [number, number]) => void; active: boolean }) {
 useMapEvents({
 click(e) {
 if (active) {
 onSelect([Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))]);
 }
 }
 });
 return null;
}

// Map View Controller with Damped Pan Smoothing
function MapAutoCenter({ center }: { center: [number, number] }) {
 const map = useMap();
 const lastCenterRef = useRef<[number, number] | null>(null);

 useEffect(() => {
 if (!center || (center[0] === 0 && center[1] === 0)) return;
 if (!lastCenterRef.current) {
 lastCenterRef.current = center;
 map.setView(center, map.getZoom());
 return;
 }
 // Only smooth-pan if distance moved is greater than 10 meters, preventing micro-pan stutter
 const dist = calculateDistance(lastCenterRef.current[0], lastCenterRef.current[1], center[0], center[1]);
 if (dist >= 10) {
 lastCenterRef.current = center;
 map.panTo(center, { animate: true, duration: 1.0, easeLinearity: 0.25 });
 }
 }, [center, map]);
 return null;
}

// Play audio alert tone
function playChime(freq1 = 587.33, freq2 = 880) {
 try {
 const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
 if (!AudioCtx) return;
 const ctx = new AudioCtx();
 const osc = ctx.createOscillator();
 const gain = ctx.createGain();
 osc.type ='sine';
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

export default function ResponderView({ onBack }: ResponderViewProps) {
 const { userProfile, logout } = useAuth();
 const { settings } = useUserSettings();

 const handleLogout = async () => {
 const responderId = userProfile?.uid || latestPresenceRef.current?.id;
 if (responderId) {
 syncResponderPresenceToFirestore({
 id: responderId,
 callSign: callSign ||'Unit',
 apparatus,
 status:'offline'
 } as any).catch(() => {});
 }
 await logout();
 onBack();
 };

 // Role detection: PNP -> Police, BFP -> Fire, CDRRMO / default -> Ambulance
 const initialApparatus: ApparatusType = (() => {
 const agencyCode = (userProfile?.agency ||'').toUpperCase();
 const roleText = (userProfile?.responderRole ||'').toLowerCase();
 const unitText = (userProfile?.vehicleUnit ||'').toLowerCase();

 if (agencyCode ==='PNP' || roleText.includes('police') || unitText.includes('patrol')) {
 return'police';
 }
 if (agencyCode ==='BFP' || roleText.includes('fire') || unitText.includes('engine')) {
 return'fire';
 }
 return'ambulance';
 })();

 const [apparatus, setApparatus] = useState<ApparatusType>(initialApparatus);
 const [callSign, setCallSign] = useState<string>(
 userProfile?.callSign || userProfile?.vehicleUnit || (initialApparatus ==='police' ?'Patrol Cruiser' : initialApparatus ==='fire' ?'Rescue Engine' :'Medic Unit')
 );

 // Keep apparatus locked to user's registered role from sign-up
 useEffect(() => {
 const agencyCode = (userProfile?.agency ||'').toUpperCase();
 const roleText = (userProfile?.responderRole ||'').toLowerCase();
 const unitText = (userProfile?.vehicleUnit ||'').toLowerCase();

 let detected: ApparatusType ='ambulance';
 if (agencyCode ==='PNP' || roleText.includes('police') || unitText.includes('patrol')) {
 detected ='police';
 } else if (agencyCode ==='BFP' || roleText.includes('fire') || unitText.includes('engine')) {
 detected ='fire';
 }
 setApparatus(detected);

 if (userProfile?.callSign || userProfile?.vehicleUnit) {
 setCallSign(userProfile.callSign || userProfile.vehicleUnit ||'');
 }
 }, [userProfile?.agency, userProfile?.responderRole, userProfile?.vehicleUnit, userProfile?.callSign]);

 // Status Mode: offline | waiting | incoming | en_route | on_scene | transporting
 const [mode, setMode] = useState<ResponderMode>('waiting');

 // Real GPS Geolocation Tracking
 const [deviceGpsCoords, setDeviceGpsCoords] = useState<[number, number] | null>(() => {
 if (typeof window !=='undefined') {
 try {
 const cached = sessionStorage.getItem('serd_real_user_location') || localStorage.getItem('serd_real_user_location');
 if (cached) return JSON.parse(cached);
 } catch {}
 }
 return null;
 });
 const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
 const [isGpsActive, setIsGpsActive] = useState<boolean>(false);
 const [followGps, setFollowGps] = useState<boolean>(true);

 // Live CAD Incidents from Database
 const [liveIncidents, setLiveIncidents] = useState<FirestoreIncident[]>([]);
 const [activeIncident, setActiveIncident] = useState<FirestoreIncident | null>(null);
 const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
 const [routePoints, setRoutePoints] = useState<[number, number][]>([]);

 // Comms & Messages State
 const [isMessagesOpen, setIsMessagesOpen] = useState(false);
 const [unreadCount, setUnreadCount] = useState(0);
 const [messageInput, setMessageInput] = useState('');
 const [messages, setMessages] = useState<IncidentChatMessage[]>([]);

 // Messenger App & Direct Comms State
 const [directChats, setDirectChats] = useState<DirectChat[]>([]);
 const [activeChatId, setActiveChatId] = useState<string | null>(null);
 const [activeChatRecipient, setActiveChatRecipient] = useState<{ id: string; name: string; type: string; apparatus?: string; phone?: string } | null>(null);
 const [activeChatMessages, setActiveChatMessages] = useState<DirectChatMessage[]>([]);
 const [chatSearchQuery, setChatSearchQuery] = useState('');
 const [messengerFilter, setMessengerFilter] = useState<'all' |'citizens' |'units'>('all');
 const [onlineFleet, setOnlineFleet] = useState<LiveOnlineResponder[]>([]);
 const responderChatScrollRef = useRef<HTMLDivElement>(null);

 const activeChatIdRef = useRef<string | null>(activeChatId);
 activeChatIdRef.current = activeChatId;

 // Track initial load so login doesn't immediately hijack screen with old emergencies
 const isInitialLoadRef = useRef(true);
 const knownIncidentIdsRef = useRef<Set<string>>(new Set());

 // Socket connection for real-time WebSocket CAD events
 const socketRef = useRef<Socket | null>(null);
 const activeIncidentRef = useRef<FirestoreIncident | null>(activeIncident);
 activeIncidentRef.current = activeIncident;
 const isMessagesOpenRef = useRef<boolean>(isMessagesOpen);
 isMessagesOpenRef.current = isMessagesOpen;

 // GPS Kalman & Outlier Suppression Filter (realistic accuracy ceiling)
 const gpsFilterRef = useRef<GpsFilter>(new GpsFilter({
 maxAcceptableAccuracy: 3000, // Accept GPS & Wi-Fi fixes
 maxPlausibleSpeedMps: 45, // ~162 km/h vehicle speed ceiling
 stationaryThresholdMeters: 2.5, // Deadband to stop micro-jitter when stopped
 smoothingFactor: 0.35 // Adaptive Exponential Moving Average
 }));

 // Helper to identify if an incident is active vs completed/cancelled
 const isIncidentActive = (inc: FirestoreIncident) => {
 return inc.status !=='cancelled' && inc.status !=='completed';
 };

 // 1. Initialize Real GPS Geolocation Listener with Kalman Outlier Filtering
 useEffect(() => {
 if (typeof navigator ==='undefined' || !('geolocation' in navigator)) return;

 if (deviceGpsCoords && !(deviceGpsCoords[0] === 0 && deviceGpsCoords[1] === 0)) {
 gpsFilterRef.current.reset(deviceGpsCoords);
 }

 const handlePos = (pos: GeolocationPosition) => {
 const filtered = gpsFilterRef.current.update(pos);
 if (filtered.coords && !(filtered.coords[0] === 0 && filtered.coords[1] === 0)) {
 setDeviceGpsCoords(filtered.coords);
 setGpsAccuracy(filtered.accuracy);
 setIsGpsActive(true);

 try {
 sessionStorage.setItem('serd_real_user_location', JSON.stringify(filtered.coords));
 localStorage.setItem('serd_real_user_location', JSON.stringify(filtered.coords));
 } catch {}
 }
 };

 // Immediate single fix for fastest presence lock
 navigator.geolocation.getCurrentPosition(
 handlePos,
 () => {},
 { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
 );

 const watchId = navigator.geolocation.watchPosition(
 handlePos,
 (err) => {
 console.info('[Responder GPS] Notice:', err.message);
 },
 { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
 );

 return () => navigator.geolocation.clearWatch(watchId);
 }, []);

 // 2. Real-time Incident Subscription from Database
 useEffect(() => {
 // Initial fetch from API - exclude completed/cancelled emergencies
 fetchIncidents().then((list) => {
 if (list && list.length > 0) {
 const activeList = (list as FirestoreIncident[]).filter(isIncidentActive);
 setLiveIncidents(activeList);
 }
 });

 // Real-time Firestore subscription
 const unsubscribe = subscribeToIncidents((firestoreList) => {
 if (!firestoreList) return;

 // Filter out completed and cancelled emergencies
 const activeList = firestoreList.filter(isIncidentActive);
 setLiveIncidents(activeList);

 // On initial login load, record all existing IDs so responder stays cleanly on STANDBY
 if (isInitialLoadRef.current) {
 activeList.forEach((inc) => {
 if (inc.id) knownIncidentIdsRef.current.add(inc.id);
 });
 isInitialLoadRef.current = false;
 return; // Prevent auto-alert takeover when logging in!
 }

 // If active incident was completed or cancelled remotely, clear it
 if (activeIncidentRef.current?.id) {
 const matchingDoc = firestoreList.find((i) => i.id === activeIncidentRef.current?.id);
 if (matchingDoc && (matchingDoc.status ==='cancelled' || matchingDoc.status ==='completed')) {
 setActiveIncident(null);
 setMode('waiting');
 setRouteResult(null);
 setRoutePoints([]);
 }
 }

 // Check for brand new emergency created AFTER responder was already logged in
 const brandNewDispatched = activeList.find((inc) => {
 if (!inc.id || knownIncidentIdsRef.current.has(inc.id)) return false;
 if (inc.status !=='dispatched' && inc.status !=='pending') return false;

 const myIds = [userProfile?.uid, callSign,`resp-${apparatus}`].filter(Boolean) as string[];

 // Check if already declined by this responder
 if (inc.declinedBy && (inc.declinedBy.includes(callSign) || (userProfile?.uid && inc.declinedBy.includes(userProfile.uid)))) {
 return false;
 }

 // CRITICAL REQUIREMENT: Only the selected responder can be dispatched
 if (inc.targetResponderId) {
 return myIds.includes(inc.targetResponderId) || inc.recommendedUnit === callSign;
 }

 // If no explicit targetResponderId was set, check general SOS or service match
 if (inc.isGeneralSos) return true;
 return !inc.service || inc.service === apparatus;
 });

 // Update known IDs
 activeList.forEach((inc) => {
 if (inc.id) knownIncidentIdsRef.current.add(inc.id);
 });

 // Auto-alert responder only for genuinely new dispatches while standing by
 if (brandNewDispatched && mode ==='waiting' && !activeIncidentRef.current) {
 setActiveIncident(brandNewDispatched);
 setMode('incoming');
 playChime(523.25, 783.99);
 if (typeof navigator !=='undefined' &&'vibrate' in navigator) {
 try { navigator.vibrate([200, 100, 200]); } catch {}
 }
 }
 });

 // Socket.io integration for instant push alerts
 const socket = io();
 socketRef.current = socket;

 socket.on('connect', () => {
 const coords = deviceGpsCoords || (() => {
 try {
 const cached = sessionStorage.getItem('serd_real_user_location') || localStorage.getItem('serd_real_user_location');
 if (cached) return JSON.parse(cached);
 } catch {}
 return [0, 0];
 })();
 const payload = {
 id: userProfile?.uid ||`resp-${apparatus}`,
 callSign: callSign || (apparatus ==='police' ?'Patrol Cruiser' : apparatus ==='fire' ?'Rescue Engine' :'Medic Unit'),
 apparatus,
 status: mode,
 coords,
 accuracy: gpsAccuracy || 10,
 phone: userProfile?.phone ||''
 };
 socket.emit('responder-presence', payload);
 syncResponderPresence(payload).catch(() => {});
 });

 socket.on('incoming-call', (callData: any) => {
 const myIds = [userProfile?.uid, callSign,`resp-${apparatus}`].filter(Boolean) as string[];

 // CRITICAL REQUIREMENT: Only the selected responder can be dispatched
 if (callData.targetResponderId) {
 const isTargeted = myIds.includes(callData.targetResponderId) || callData.recommendedUnit === callSign;
 if (!isTargeted) return;
 } else if (!callData.isGeneralSos && callData.service && callData.service !== apparatus) {
 return;
 }

 console.log('[CAD Socket] Incoming call event:', callData);
 playChime(523.25, 783.99);
 if (typeof navigator !=='undefined' &&'vibrate' in navigator) {
 try { navigator.vibrate([250, 100, 250]); } catch {}
 }
 // Re-fetch to get complete ticket
 fetchIncidents().then((list) => {
 if (list && list.length > 0) {
 const activeList = (list as FirestoreIncident[]).filter(isIncidentActive);
 setLiveIncidents(activeList);
 const found = activeList.find(i => i.id === callData.citizenId || i.id === callData.id);
 if (found && mode ==='waiting' && !activeIncidentRef.current) {
 setActiveIncident(found as FirestoreIncident);
 setMode('incoming');
 }
 }
 });
 });

 // Listen to auto-reassigned alerts when another unit declined
 socket.on('incident-reassigned', (data: any) => {
 const myIds = [userProfile?.uid, callSign,`resp-${apparatus}`].filter(Boolean) as string[];
 const isForMe = data?.nextUnit && (myIds.includes(data.nextUnit.id) || data.nextUnit.callSign === callSign);
 if (isForMe) {
 playChime(523.25, 783.99);
 if (typeof navigator !=='undefined' &&'vibrate' in navigator) {
 try { navigator.vibrate([250, 100, 250]); } catch {}
 }
 fetchIncidents().then((list) => {
 if (list && list.length > 0) {
 const activeList = (list as FirestoreIncident[]).filter(isIncidentActive);
 setLiveIncidents(activeList);
 const found = activeList.find(i => i.id === data.incidentId);
 if (found && mode ==='waiting' && !activeIncidentRef.current) {
 setActiveIncident(found as FirestoreIncident);
 setMode('incoming');
 }
 }
 });
 }
 });

 socket.on('incident-message', (data: { incidentId: string; message: IncidentChatMessage }) => {
 setMessages(prev => {
 if (prev.some(m => m.id === data.message.id)) return prev;
 return [...prev, data.message];
 });
 if (!isMessagesOpenRef.current) {
 setUnreadCount(c => c + 1);
 playChime(880, 1174.66);
 }
 });

 socket.on('direct-message', (data: { chatId: string; message: any; chat?: any }) => {
 const respId = userProfile?.uid ||`resp-${apparatus}`;
 const isForMe = !data.chat || 
 data.chat.responderId === respId || 
 data.chat.responderId === userProfile?.uid || 
 (data.chat.responderName && data.chat.responderName.toLowerCase() === callSign.toLowerCase()) ||
 (data.chatId && (data.chatId.includes(respId) || (userProfile?.uid && data.chatId.includes(userProfile.uid))));

 if (isForMe) {
 if (data.chatId === activeChatIdRef.current) {
 setActiveChatMessages(prev => {
 if (prev.some(m => m.id === data.message.id)) return prev;
 return [...prev, data.message];
 });
 }
 if (data.message.senderRole !=='responder') {
 playChime(880, 1174.66);
 if (!isMessagesOpenRef.current || activeChatIdRef.current !== data.chatId) {
 setUnreadCount(c => c + 1);
 }
 }
 }
 });

 return () => {
 unsubscribe();
 socket.disconnect();
 };
 }, []);

 // Current real position of the vehicle
 const currentVehicleCoords: [number, number] = deviceGpsCoords || (() => {
 try {
 const cached = sessionStorage.getItem('serd_real_user_location') || localStorage.getItem('serd_real_user_location');
 if (cached) return JSON.parse(cached);
 } catch {}
 return [0, 0];
 })();

 // Broadcast live responder presence and apparatus to server & Citizen MapScreen
 const latestPresenceRef = useRef<any>(null);

 const broadcastPresence = () => {
 let coordsToSend = currentVehicleCoords;
 if (!coordsToSend || (coordsToSend[0] === 0 && coordsToSend[1] === 0)) {
 try {
 const cached = sessionStorage.getItem('serd_real_user_location') || localStorage.getItem('serd_real_user_location');
 if (cached) coordsToSend = JSON.parse(cached);
 } catch {}
 }

 const payload = {
 id: userProfile?.uid ||`resp-${apparatus}`,
 callSign: callSign || (apparatus ==='police' ?'Patrol Cruiser' : apparatus ==='fire' ?'Rescue Engine' :'Medic Unit'),
 apparatus,
 status: mode,
 coords: coordsToSend || [14.5995, 120.9842],
 accuracy: gpsAccuracy || 10,
 phone: userProfile?.phone ||''
 };

 latestPresenceRef.current = payload;

 // Cache locally for instant multi-tab sync
 try {
 localStorage.setItem('serd_latest_online_responder', JSON.stringify({
 ...payload,
 timestamp: Date.now()
 }));
 } catch {}

 // 1. Instant Firestore Sync (Real-time Cloud Sync for All Devices)
 syncResponderPresenceToFirestore(payload as any).catch((err) => {
 console.warn('[Firestore] Responder presence sync notice:', err);
 });

 // 2. Socket.io & REST fallback
 if (socketRef.current?.connected) {
 socketRef.current.emit('responder-presence', payload);
 }
 syncResponderPresence(payload).catch(() => {});
 };

 // Immediate presence broadcast when key profile or status changes
 useEffect(() => {
 broadcastPresence();
 }, [apparatus, callSign, mode, userProfile?.uid]);

 // Continuous background heartbeat every 3 seconds - does NOT reset on every coordinate jitter
 useEffect(() => {
 const timer = setInterval(() => {
 broadcastPresence();
 }, 3000);

 const handleVisibilityOrFocus = () => {
 if (document.visibilityState ==='visible') {
 broadcastPresence();
 }
 };

 document.addEventListener('visibilitychange', handleVisibilityOrFocus);
 window.addEventListener('focus', handleVisibilityOrFocus);

 return () => {
 clearInterval(timer);
 document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
 window.removeEventListener('focus', handleVisibilityOrFocus);

 const responderId = userProfile?.uid || latestPresenceRef.current?.id;
 if (responderId) {
 syncResponderPresenceToFirestore({
 id: responderId,
 callSign: callSign ||'Unit',
 apparatus,
 status:'offline'
 } as any).catch(() => {});
 }
 };
 }, []);

 // Responder-selected drop-off destination
 const [dropoffDestination, setDropoffDestination] = useState<{
 name: string;
 coords?: [number, number];
 } | null>(null);
 const [isPickingDropoffOnMap, setIsPickingDropoffOnMap] = useState<boolean>(false);
 const [showDropoffModal, setShowDropoffModal] = useState<boolean>(false);
 const [customDropoffName, setCustomDropoffName] = useState<string>('');

 // Load messages whenever activeIncident changes
 useEffect(() => {
 if (activeIncident?.id) {
 fetchIncidentMessages(activeIncident.id).then(msgs => {
 if (msgs && msgs.length > 0) {
 setMessages(msgs);
 } else {
 // Default initial radio log
 setMessages([
 {
 id:'init-1',
 sender:'dispatch',
 senderName:'System',
 text:`Incident ${activeIncident.code ||'10-79'} assigned to ${callSign}. Location: ${activeIncident.location}. Respond with caution.`,
 timestamp: activeIncident.reportedTime ||'Now',
 isUrgent: true
 }
 ]);
 }
 });
 }
 }, [activeIncident?.id, callSign]);

 // Subscribe to all incoming direct chats addressed to this responder in real time
 useEffect(() => {
 const responderIdentifier = {
 id:`resp-${apparatus}`,
 uid: userProfile?.uid,
 callSign,
 apparatus
 };
 const unsub = subscribeToDirectChatsForResponder(responderIdentifier, (chats) => {
 setDirectChats(chats);
 if (chats.length > 0) {
 const top = chats[0];
 // If newest message is from a citizen and the responder doesn't have this chat open, notify
 if (top.lastMessageSender !== callSign && (!isMessagesOpenRef.current || activeChatIdRef.current !== top.id)) {
 setUnreadCount(c => c + 1);
 playChime(880, 1174.66);
 }
 }
 });
 return () => unsub();
 }, [userProfile?.uid, apparatus, callSign]);

 // Subscribe to online fleet so responder can see other units in messenger
 useEffect(() => {
 const unsub = subscribeToOnlineResponders((fleet) => {
 setOnlineFleet(fleet.filter(u => u.id !== (userProfile?.uid ||`resp-${apparatus}`)));
 });
 return () => unsub();
 }, [userProfile?.uid, apparatus]);

 // Filtered chats and units for Messenger app
 const filteredDirectChats = useMemo(() => {
 if (messengerFilter ==='units') return [];
 
 // Combine direct chats and citizens from active incident queue
 const list: DirectChat[] = [...directChats];
 const seenCitizenIds = new Set(list.map(c => c.citizenId));

 liveIncidents.forEach(inc => {
 const citId = inc.citizenId || inc.id;
 if (citId && !seenCitizenIds.has(citId) && inc.patientName) {
 seenCitizenIds.add(citId);
 const derivedChatId = getDirectChatId(citId, userProfile?.uid ||`resp-${apparatus}`);
 list.push({
 id: derivedChatId,
 citizenId: citId,
 citizenName: inc.patientName,
 responderId: userProfile?.uid ||`resp-${apparatus}`,
 responderName: callSign,
 responderApparatus: apparatus,
 lastMessage:`Incident assignment: ${inc.type}`,
 lastMessageSender:'Citizen',
 lastMessageTime: inc.reportedTime ||'Active'
 });
 }
 });

 if (!chatSearchQuery.trim()) return list;
 const q = chatSearchQuery.toLowerCase();
 return list.filter(c => 
 c.citizenName.toLowerCase().includes(q) || 
 c.lastMessage.toLowerCase().includes(q)
 );
 }, [directChats, liveIncidents, chatSearchQuery, messengerFilter, callSign, userProfile?.uid, apparatus]);

 const filteredUnits = useMemo(() => {
 if (messengerFilter ==='citizens') return [];
 if (!chatSearchQuery.trim()) return onlineFleet;
 const q = chatSearchQuery.toLowerCase();
 return onlineFleet.filter(u => 
 u.callSign.toLowerCase().includes(q) || 
 u.apparatus.toLowerCase().includes(q)
 );
 }, [onlineFleet, chatSearchQuery, messengerFilter]);

 // Subscribe to messages in the active direct chat
 useEffect(() => {
 if (!activeChatId) {
 setActiveChatMessages([]);
 return;
 }
 const unsub = subscribeToDirectChatMessages(activeChatId, (msgs) => {
 setActiveChatMessages(msgs);
 });
 return () => unsub();
 }, [activeChatId]);

 // Smooth scroll to bottom when chat messages update or chat opens
 useEffect(() => {
 if (activeChatId && responderChatScrollRef.current) {
 responderChatScrollRef.current.scrollTop = responderChatScrollRef.current.scrollHeight;
 }
 }, [activeChatMessages, activeChatId]);

 // 3. Compute real Dijkstra road route when entering en_route or transporting
 const lastRoutedCoordsRef = useRef<[number, number] | null>(null);

 useEffect(() => {
 const currentLoc = currentVehicleCoords;

 if (mode ==='en_route' && activeIncident?.coords) {
 const distFromLastRoute = lastRoutedCoordsRef.current
 ? calculateDistance(lastRoutedCoordsRef.current[0], lastRoutedCoordsRef.current[1], currentLoc[0], currentLoc[1])
 : 999;

 // Only re-calculate road route if vehicle moved more than 35m or on mode start
 if (distFromLastRoute < 35 && routeResult) return;

 lastRoutedCoordsRef.current = currentLoc;
 calculateRealRoute(currentLoc, activeIncident.coords)
 .then((res) => {
 setRouteResult(res);
 setRoutePoints(res.coordinates);
 })
 .catch(() => {});
 } else if (mode ==='transporting' && activeIncident?.coords && dropoffDestination?.coords) {
 calculateRealRoute(activeIncident.coords, dropoffDestination.coords)
 .then((res) => {
 setRouteResult(res);
 setRoutePoints(res.coordinates);
 })
 .catch(() => {});
 } else if (mode ==='waiting' || mode ==='offline') {
 setRouteResult(null);
 setRoutePoints([]);
 lastRoutedCoordsRef.current = null;
 }
 }, [mode, activeIncident?.coords, currentVehicleCoords, dropoffDestination?.coords]);

 // Actions for incident workflow
 const handleAcceptDispatch = async () => {
 if (!activeIncident) return;
 setMode('en_route');
 playChime(784, 1046.5);
 if (activeIncident.id) {
 await updateIncidentStatus(activeIncident.id,'en_route', {
 acceptedUnit: callSign,
 acceptedUnitId: userProfile?.uid || callSign,
 coords: currentVehicleCoords,
 apparatus
 });

 // Automatically message citizen that responder has accepted and is en route for their condition
 const conditionSnippet = activeIncident.details ? activeIncident.details.split('\n')[0].replace(/🚨\s*/, '') : activeIncident.type;
 const acceptMsg = `Assigned Unit ${callSign} (${apparatus.toUpperCase()}) has ACCEPTED dispatch for your emergency (${conditionSnippet}). En route with priority response.`;

 sendIncidentMessage(activeIncident.id, {
 sender: 'responder',
 senderName: callSign,
 text: acceptMsg,
 isUrgent: false
 }).catch(() => {});

 const citUid = activeIncident.id.replace('INC-', 'cit_');
 const directChatId = getDirectChatId(citUid, userProfile?.uid || `resp-${apparatus}`);
 sendDirectChatMessage(directChatId, {
 senderId: userProfile?.uid || `resp-${apparatus}`,
 senderName: callSign,
 senderRole: 'responder',
 text: acceptMsg,
 citizenId: citUid,
 citizenName: activeIncident.patientName || 'Citizen',
 responderId: userProfile?.uid || `resp-${apparatus}`,
 responderName: callSign,
 responderApparatus: apparatus
 }).catch(() => {});
 }
 };

 const handleDeclineDispatch = async () => {
 if (!activeIncident) return;
 const incId = activeIncident.id;
 setMode('waiting');
 setActiveIncident(null);
 playChime(440, 330);
 if (incId) {
 await declineEmergencyIncident(incId, {
 responderId: userProfile?.uid || callSign,
 callSign,
 apparatus,
 availableResponders: onlineFleet
 });
 }
 };

 const handleMarkArrivedOnScene = async () => {
 if (!activeIncident) return;
 setMode('on_scene');
 playChime(659.25, 880);
 if (activeIncident.id) {
 await updateIncidentStatus(activeIncident.id,'on_scene');
 }
 };

 const handleCommenceTransport = (destination?: { name: string; coords?: [number, number] }) => {
 if (!activeIncident) return;
 if (destination) {
 setDropoffDestination(destination);
 }
 setMode('transporting');
 setShowDropoffModal(false);
 setIsPickingDropoffOnMap(false);
 playChime(587.33, 880);
 if (activeIncident.id) {
 updateIncidentStatus(activeIncident.id,'en_route');
 }
 };

 const handleCompleteHandover = async () => {
 if (activeIncident?.id) {
 await updateIncidentStatus(activeIncident.id,'completed');
 }
 setMode('waiting');
 setActiveIncident(null);
 setRouteResult(null);
 setRoutePoints([]);
 setDropoffDestination(null);
 setIsPickingDropoffOnMap(false);
 setShowDropoffModal(false);
 playChime(523.25, 1046.5);
 };

 const handleDismissIncident = async (e: React.MouseEvent, incidentId: string) => {
 e.stopPropagation();
 await updateIncidentStatus(incidentId,'completed');
 setLiveIncidents(prev => prev.filter(i => i.id !== incidentId));
 };

 const handleClearAllIncidents = async () => {
 for (const inc of liveIncidents) {
 if (inc.id) {
 await updateIncidentStatus(inc.id,'completed');
 }
 }
 setLiveIncidents([]);
 };

 // Real messaging send (supports Messenger direct chats)
 const handleSendMessage = async (customText?: string) => {
 const text = (customText || messageInput).trim();
 if (!text) return;

 setMessageInput('');
 playChime(784, 1046.5);

 // If active conversation is a contact direct chat:
 if (activeChatId) {
 const selectedChat = directChats.find(c => c.id === activeChatId);
 const citId = selectedChat?.citizenId || activeChatRecipient?.id ||'contact';
 const citName = selectedChat?.citizenName || activeChatRecipient?.name ||'Contact';

 const sent = await sendDirectChatMessage(activeChatId, {
 senderId: userProfile?.uid ||`resp-${apparatus}`,
 senderName:`${callSign} (${apparatus.toUpperCase()})`,
 senderRole:'responder',
 text,
 citizenId: citId,
 citizenName: citName,
 responderId: userProfile?.uid ||`resp-${apparatus}`,
 responderName: callSign,
 responderApparatus: apparatus
 });

 if (sent) {
 setActiveChatMessages(prev => {
 if (prev.some(m => m.id === sent.id)) return prev;
 return [...prev, sent];
 });
 }
 return;
 }
 const targetIncId = (activeIncident && activeChatId === activeIncident.id) ? activeIncident.id : (activeIncident?.id ||'dispatch_broadcast');
 const payload = {
 sender:'responder' as const,
 senderName:`${callSign} (${apparatus.toUpperCase()})`,
 text,
 isUrgent: false
 };

 if (activeIncident?.id) {
 const created = await sendIncidentMessage(targetIncId, payload);
 if (created) {
 setMessages(prev => [...prev, created]);
 }
 } else {
 setMessages(prev => [
 ...prev,
 {
 id:'msg-' + Date.now(),
 sender:'responder',
 senderName:`${callSign} (${apparatus.toUpperCase()})`,
 text,
 timestamp: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
 }
 ]);
 }
 };

 const handleOpenMessages = () => {
 if (directChats.length === 1) {
 const chat = directChats[0];
 setActiveChatId(chat.id);
 setActiveChatRecipient({ id: chat.citizenId, name: chat.citizenName, type:'citizen', apparatus: chat.responderApparatus });
 } else {
 setActiveChatId(null);
 }
 setIsMessagesOpen(true);
 setUnreadCount(0);
 };

 // Active map focal point
 const mapCenter: [number, number] = (() => {
 if (followGps && currentVehicleCoords) return currentVehicleCoords;
 if (mode ==='en_route' && activeIncident?.coords) return activeIncident.coords;
 if (mode ==='transporting' && dropoffDestination?.coords) return dropoffDestination.coords;
 return currentVehicleCoords;
 })();

 return (
 <div className="relative w-full h-[100dvh] bg-neutral-950 text-neutral-900 font-sans overflow-hidden select-none">
 
 {/* Fullscreen Map Canvas */}
 <div className="absolute inset-0 z-0">
 <MapContainer
 center={currentVehicleCoords}
 zoom={15}
 zoomControl={false}
 style={{ height:'100%', width:'100%' }}
 >
 <TileLayer
 attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
 url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
 />

 <MapAutoCenter center={mapCenter} />

 {/* Real Dynamic Responder Vehicle Marker (Driven by Real GPS) */}
 <Marker 
 position={currentVehicleCoords} 
 icon={createVehicleIcon(apparatus, callSign)} 
 zIndexOffset={1000} 
 />

 {/* Real Incident Site Marker */}
 {activeIncident?.coords && (mode ==='incoming' || mode ==='en_route' || mode ==='on_scene') && (
 <Marker 
 position={activeIncident.coords} 
 icon={createIncidentMarkerIcon(activeIncident.patientName)} 
 />
 )}

 {/* Responder's Selected Drop-off Destination Marker */}
 {(mode ==='transporting' || isPickingDropoffOnMap) && dropoffDestination?.coords && (
 <Marker 
 position={dropoffDestination.coords} 
 icon={createDropoffMarkerIcon(dropoffDestination.name)} 
 />
 )}

 {/* Interactive Map Picker when responder clicks'Pick Location on Map' */}
 <MapLocationPicker
 active={isPickingDropoffOnMap}
 onSelect={(coords) => {
 const name = customDropoffName.trim() ||'Custom Drop-off Pin';
 setDropoffDestination({ name, coords });
 setIsPickingDropoffOnMap(false);
 setShowDropoffModal(false);
 playChime(659.25, 880);
 }}
 />

 {/* Real-time Dijkstra Road Path Polyline */}
 {routePoints.length > 0 && (
 <Polyline
 positions={routePoints}
 color={apparatus ==='police' ?'#1d4ed8' : apparatus ==='fire' ?'#d97706' :'#0f172a'}
 weight={6}
 opacity={0.88}
 lineCap="round"
 lineJoin="round"
 />
 )}
 </MapContainer>
 </div>

 {/* Floating Prompt when selecting drop-off location on map */}
 {isPickingDropoffOnMap && (
 <div className="absolute top-16 left-3 sm:left-4 right-3 sm:right-4 z-40 bg-blue-950/95 text-white rounded-2xl p-3 shadow-2xl border border-blue-500/50 flex items-center justify-between animate-[fade-in_0.2s_ease-out]">
 <div className="flex items-center gap-2.5">
 <MapPin className="w-5 h-5 text-blue-400 shrink-0 animate-bounce" />
 <div>
 <p className="text-xs font-bold text-white leading-tight">Tap Map to Set Drop-off Point</p>
 <p className="text-[10px] text-blue-200">Click anywhere on the map to set destination pin</p>
 </div>
 </div>
 <button
 onClick={() => setIsPickingDropoffOnMap(false)}
 className="px-3 py-1.5 rounded-xl bg-neutral-800 text-xs font-semibold text-neutral-300 cursor-pointer"
 >
 Cancel
 </button>
 </div>
 )}

 {/* Top Floating Header Bar */}
 <div className="absolute top-3 sm:top-4 left-3 sm:left-4 right-3 sm:right-4 z-20 flex items-center justify-between pointer-events-none">
 
 {/* Left: Log Out Button & Active Unit Badge */}
 <div className="flex items-center gap-2 pointer-events-auto">
 <button
 onClick={handleLogout}
 className="w-10 h-10 sm:w-11 sm:h-11 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md rounded-2xl shadow-lg border border-neutral-200/80 dark:border-neutral-800 flex items-center justify-center text-rose-600 dark:text-rose-400 active:scale-95 transition-all cursor-pointer"
 aria-label="Log Out from Responder Unit"
 title="Log Out"
 >
 <LogOut className="w-5 h-5" />
 </button>

 {/* Active Unit Badge (locked to registered profile from sign-up) */}
 <div className="flex items-center gap-2.5 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md rounded-2xl px-3 sm:px-3.5 py-2 shadow-lg border border-neutral-200/80 dark:border-neutral-800">
 <span className="text-xl shrink-0">
 {apparatus ==='police' ?'🚓' : apparatus ==='fire' ?'🚒' :'🚑'}
 </span>
 <div className="flex flex-col min-w-0 pr-1">
 <span className="text-xs font-bold text-neutral-900 dark:text-white leading-tight truncate max-w-[130px] sm:max-w-[180px]">
 {callSign || userProfile?.vehicleUnit || (apparatus ==='police' ?'PNP Patrol' : apparatus ==='fire' ?'BFP Fire Unit' :'EMS Ambulance')}
 </span>
 <span className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 leading-none mt-0.5">
 {userProfile?.agency 
 ? (userProfile.agency ==='BFP' ?'Fire (BFP)' : userProfile.agency ==='PNP' ?'PNP (Police)' :'Paramedics (CDRRMO)') 
 : (apparatus ==='police' ?'PNP Police' : apparatus ==='fire' ?'Fire / BFP' :'Paramedics EMS')}
 </span>
 </div>
 </div>
 </div>

 {/* Right: GPS Status & Messages Notification Center */}
 <div className="flex items-center gap-2 pointer-events-auto">
 {/* GPS Tracking Badge / Recenter */}
 <button
 onClick={() => setFollowGps(!followGps)}
 className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-2xl shadow-lg border backdrop-blur-md text-xs font-bold transition-all cursor-pointer ${
 isGpsActive
 ?'bg-emerald-50/95 border-emerald-300 text-emerald-800'
 :'bg-white/95 border-neutral-200 text-neutral-600'
 }`}
 title={isGpsActive ?`Live GPS Locked (±${gpsAccuracy}m)` :'GPS Acquiring...'}
 >
 <LocateFixed className={`w-4 h-4 ${isGpsActive ?'text-emerald-600' :'text-neutral-400'}`} />
 <span className="hidden sm:inline">{isGpsActive ?`±${gpsAccuracy}m` :'Locating'}</span>
 </button>

 {/* Messages & Patrol Comms Button with Notification Badge */}
 <button
 onClick={handleOpenMessages}
 className="relative w-10 h-10 sm:w-11 sm:h-11 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md rounded-2xl shadow-lg border border-neutral-200/80 dark:border-neutral-800 flex items-center justify-center text-neutral-800 dark:text-white active:scale-95 transition-all cursor-pointer"
 aria-label="Messages & Patrol Comms"
 title="Messages & Patrol Comms"
 >
 <MessageSquare className="w-5 h-5 text-neutral-800 dark:text-white" />
 {unreadCount > 0 && (
 <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-[#B41A46] text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-md">
 {unreadCount}
 </span>
 )}
 </button>
 </div>
 </div>

 {/* Mode: EN ROUTE - Real-time Turn Navigation HUD */}
 {(mode ==='en_route' || mode ==='transporting') && routeResult && (
 <div className="absolute top-16 left-3 sm:left-4 right-3 sm:right-4 z-20 bg-neutral-950 text-white rounded-2xl p-3.5 shadow-2xl border border-neutral-800 animate-[fade-in_0.2s_ease-out]">
 <div className="flex items-center justify-between">
 <div className="flex items-center space-x-3 min-w-0 pr-2">
 <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
 <CornerUpRight className="w-6 h-6" />
 </div>
 <div className="min-w-0">
 <p className="text-[11px] text-neutral-400 font-mono uppercase tracking-wider truncate">
 {mode ==='transporting' ?'Drop-off Transit' :'Navigating to Emergency Scene'}
 </p>
 <h3 className="text-xs sm:text-sm font-bold text-white tracking-tight leading-snug truncate">
 {mode ==='transporting' ? (dropoffDestination?.name ||'Drop-off Destination') : (activeIncident?.location ||'Target Scene')}
 </h3>
 </div>
 </div>

 <div className="text-right shrink-0">
 <span className="block text-sm font-extrabold text-emerald-400 font-mono">
 {formatEta(routeResult.durationSeconds)}
 </span>
 <span className="block text-[10px] text-neutral-400 font-mono">
 {formatDistance(routeResult.distanceMeters)}
 </span>
 </div>
 </div>
 </div>
 )}

 {/* ========================================================= */}
 {/* 1. BOTTOM SHEET: STANDBY / ACTIVE QUEUE */}
 {/* ========================================================= */}
 {mode ==='waiting' && (
 <div className="absolute bottom-0 left-0 right-0 z-30 bg-white dark:bg-neutral-900 rounded-t-[28px] shadow-[0_-8px_30px_rgba(0,0,0,0.2)] p-5 border-t border-neutral-100 dark:border-neutral-800 animate-[fade-in_0.2s_ease-out]">
 <div className="w-10 h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full mx-auto mb-3" />

 <div className="flex items-center justify-between mb-3">
 <div>
 <h2 className="text-lg font-bold text-neutral-900 dark:text-white tracking-tight">
 {callSign}
 </h2>
 </div>

 <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-lg border ${
 apparatus ==='police' 
 ?'bg-blue-50 text-blue-700 border-blue-200' 
 : apparatus ==='fire' 
 ?'bg-amber-50 text-amber-700 border-amber-200' 
 :'bg-rose-50 text-rose-700 border-rose-200'
 }`}>
 {apparatus ==='police' ?'🚓' : apparatus ==='fire' ?'🚒' :'🚑'}
 </div>
 </div>

 {/* Active Incidents Queue in the Region */}
 <div className="mb-3">
 <div className="flex items-center justify-between mb-1.5">
 <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
 Available Incidents ({liveIncidents.length})
 </span>
 {liveIncidents.length > 0 && (
 <button
 onClick={handleClearAllIncidents}
 className="text-[10px] text-neutral-400 font-semibold cursor-pointer transition-colors"
 >
 Clear Queue
 </button>
 )}
 </div>

 {liveIncidents.length === 0 ? (
 <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-100 dark:border-neutral-800 text-center">
 <p className="text-xs text-neutral-500 dark:text-neutral-400">No active incidents in queue</p>
 </div>
 ) : (
 <div className="space-y-1.5 max-h-36 overflow-y-auto">
 {liveIncidents.map((inc) => (
 <div 
 key={inc.id || inc.code}
 onClick={() => {
 setActiveIncident(inc);
 setMode('incoming');
 playChime(523.25, 783.99);
 }}
 className="p-2.5 bg-neutral-50 dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 flex items-center justify-between cursor-pointer transition-colors active:scale-98"
 >
 <div className="min-w-0 flex-1 pr-2">
 <div className="flex items-center gap-1.5">
 <span className="w-1.5 h-1.5 rounded-full bg-rose-600 shrink-0"></span>
 <p className="text-xs font-bold text-neutral-900 dark:text-white truncate">{inc.type}</p>
 </div>
 <p className="text-[10px] text-neutral-500 dark:text-neutral-400 truncate pl-3">{inc.location}</p>
 </div>
 <div className="flex items-center gap-1.5 shrink-0">
 <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-mono">
 Respond &rarr;
 </span>
 <button
 onClick={(e) => handleDismissIncident(e, inc.id || inc.code)}
 className="p-1 text-neutral-400 rounded-md cursor-pointer"
 title="Dismiss / Complete"
 >
 <X className="w-3.5 h-3.5" />
 </button>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>

 <button
 onClick={() => setMode('offline')}
 className="w-full py-2.5 text-neutral-500 dark:text-neutral-400 text-xs font-semibold text-center transition-colors cursor-pointer"
 >
 Go Offline
 </button>
 </div>
 )}

 {/* ========================================================= */}
 {/* 2. BOTTOM SHEET: OFFLINE */}
 {/* ========================================================= */}
 {mode ==='offline' && (
 <div className="absolute bottom-0 left-0 right-0 z-30 bg-white dark:bg-neutral-900 rounded-t-[28px] shadow-2xl p-6 border-t border-neutral-100 dark:border-neutral-800 text-center">
 <div className="w-10 h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full mx-auto mb-3" />
 <h2 className="text-lg font-bold text-neutral-900 dark:text-white">{callSign} Offline</h2>
 <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-xs mx-auto">
 You will not receive emergency dispatch alerts or route assignments.
 </p>

 <button
 onClick={() => setMode('waiting')}
 className="w-full mt-5 py-4 bg-emerald-600 text-white rounded-2xl font-bold text-xs tracking-wider uppercase shadow-lg active:scale-[0.99] transition-all cursor-pointer"
 >
 GO ON STANDBY
 </button>
 </div>
 )}

 {/* ========================================================= */}
 {/* 3. BOTTOM SHEET: INCOMING CALL (NO 15S TIMER - STAYS ACTIVE) */}
 {/* ========================================================= */}
 {mode ==='incoming' && activeIncident && (
 <div className="absolute bottom-0 left-0 right-0 z-40 bg-neutral-950 text-white rounded-t-[28px] shadow-[0_-10px_40px_rgba(0,0,0,0.6)] p-5 border-t border-neutral-800 animate-[fade-in_0.2s_ease-out]">
 <div className="w-10 h-1 bg-neutral-800 rounded-full mx-auto mb-3" />

 <div className="flex items-start justify-between mb-3">
 <div>
 <div className="flex items-center gap-2 mb-1.5">
 <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-600 text-white uppercase tracking-wider">
 <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
 <span>PRIORITY DISPATCH &bull; {activeIncident.priority?.toUpperCase() ||'CRITICAL'}</span>
 </span>
 <span className="text-[10px] font-mono text-neutral-400">
 Target: {callSign}
 </span>
 </div>
 <h2 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
 {activeIncident.type}
 </h2>
 </div>

 <div className="w-11 h-11 rounded-2xl bg-rose-950/60 border border-rose-800/60 flex items-center justify-center text-xl shrink-0">
 {apparatus ==='police' ?'🚓' : apparatus ==='fire' ?'🚒' :'🚑'}
 </div>
 </div>

 {/* Incident Details Card */}
 <div className="p-3.5 bg-neutral-900/80 rounded-2xl border border-neutral-800 space-y-2 text-xs text-neutral-300 mb-4">
 <div className="flex items-start space-x-2">
 <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
 <span className="font-semibold text-white">{activeIncident.location}</span>
 </div>
 <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-neutral-800 text-neutral-400">
 <span>Patient / Reporter: <strong className="text-white">{activeIncident.patientName}</strong></span>
 <span className="px-1.5 py-0.5 rounded bg-neutral-800 font-mono text-white font-bold">{activeIncident.code ||'10-79'}</span>
 </div>
 {activeIncident.details && (
 <div className="mt-2 pt-2 border-t border-neutral-800 text-[11px]">
 <div className="text-amber-400 font-bold uppercase tracking-wider text-[10px] mb-1 flex items-center gap-1">
 <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
 <span>What's Wrong / Triage Report:</span>
 </div>
 <p className="text-neutral-200 whitespace-pre-line bg-neutral-950/90 p-2.5 rounded-xl border border-neutral-800 text-[11px] leading-relaxed font-sans">
 {activeIncident.details}
 </p>
 </div>
 )}
 </div>

 {/* Accept & Decline Buttons (Stays indefinitely until responder chooses) */}
 <div className="grid grid-cols-3 gap-3">
 <button
 onClick={handleDeclineDispatch}
 className="col-span-1 py-4 bg-neutral-900 text-neutral-300 rounded-2xl font-bold text-xs uppercase tracking-wider transition-colors border border-neutral-700 cursor-pointer active:scale-95"
 >
 Decline
 </button>
 <button
 onClick={handleAcceptDispatch}
 className="col-span-2 py-4 bg-[#B41A46] text-white rounded-2xl font-extrabold text-sm uppercase tracking-wider shadow-[0_4px_20px_rgba(180,26,70,0.5)] active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-2"
 >
 <Check className="w-4 h-4" />
 <span>ACCEPT DISPATCH</span>
 </button>
 </div>
 </div>
 )}

 {/* ========================================================= */}
 {/* 4. BOTTOM SHEET: EN ROUTE */}
 {/* ========================================================= */}
 {mode ==='en_route' && activeIncident && (
 <div className="absolute bottom-0 left-0 right-0 z-30 bg-white dark:bg-neutral-900 rounded-t-[28px] shadow-2xl p-5 border-t border-neutral-100 dark:border-neutral-800 animate-[fade-in_0.2s_ease-out]">
 <div className="w-10 h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full mx-auto mb-3" />

 <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
 <div>
 <span className="text-[10px] font-mono text-rose-600 font-bold uppercase tracking-wider">
 EN ROUTE &bull; {callSign}
 </span>
 <h3 className="text-base font-bold text-neutral-900 dark:text-white">{activeIncident.patientName}</h3>
 <p className="text-xs text-neutral-500 dark:text-neutral-400">{activeIncident.location}</p>
 </div>

 <div className="flex items-center gap-2">
 <button
 onClick={handleOpenMessages}
 className="relative w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white flex items-center justify-center transition-colors cursor-pointer"
 title="Message Citizen / Dispatch"
 >
 <MessageSquare className="w-4 h-4" />
 {unreadCount > 0 && (
 <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-[#B41A46] text-white text-[9px] font-bold rounded-full flex items-center justify-center shadow-xs">
 {unreadCount}
 </span>
 )}
 </button>

 <a
 href="tel:911"
 className="w-10 h-10 rounded-full bg-[#B41A46] text-white flex items-center justify-center transition-colors"
 title="Call Citizen"
 >
 <Phone className="w-4 h-4" />
 </a>
 </div>
 </div>

 {/* Incident Details / Dispatch Notes if provided */}
 {activeIncident.details && (
 <div className="mt-3 p-3 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-xs text-neutral-800 dark:text-neutral-200">
 <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-bold text-[10px] uppercase tracking-wider mb-1">
 <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
 <span>Condition & What's Wrong:</span>
 </div>
 <p className="font-medium text-[11px] leading-relaxed whitespace-pre-line text-neutral-700 dark:text-neutral-300">
 {activeIncident.details}
 </p>
 </div>
 )}

 <button
 onClick={handleMarkArrivedOnScene}
 className="w-full mt-4 py-4 bg-amber-600 text-white rounded-2xl font-bold text-xs tracking-wider uppercase shadow-lg active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
 >
 <Check className="w-4 h-4" />
 <span>MARK ARRIVED ON SCENE</span>
 </button>
 </div>
 )}

 {/* ========================================================= */}
 {/* 5. BOTTOM SHEET: ON SCENE */}
 {/* ========================================================= */}
 {mode ==='on_scene' && activeIncident && (
 <div className="absolute bottom-0 left-0 right-0 z-30 bg-white dark:bg-neutral-900 rounded-t-[28px] shadow-2xl p-5 border-t border-neutral-100 dark:border-neutral-800 animate-[fade-in_0.2s_ease-out]">
 <div className="w-10 h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full mx-auto mb-3" />

 <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
 <div>
 <span className="text-[10px] font-mono text-amber-600 font-bold uppercase tracking-wider">
 ON SCENE &bull; {callSign} ACTIVE
 </span>
 <h3 className="text-base font-bold text-neutral-900 dark:text-white">{activeIncident.patientName}</h3>
 <p className="text-xs text-neutral-500 dark:text-neutral-400">Field triage and patient stabilization</p>
 </div>
 <div className="px-2.5 py-1 bg-neutral-900 text-white rounded-lg font-mono text-xs font-bold">
 {activeIncident.code ||'10-79'}
 </div>
 </div>

 {/* Dual Action Options: Resolve on Scene OR Choose Custom Drop-off */}
 <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
 <button
 onClick={handleCompleteHandover}
 className="py-3.5 px-4 bg-emerald-600 text-white rounded-2xl font-bold text-xs tracking-wider uppercase shadow-md active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
 >
 <Check className="w-4 h-4" />
 <span>RESOLVE & CLEAR ON SCENE</span>
 </button>

 <button
 onClick={() => setShowDropoffModal(true)}
 className="py-3.5 px-4 bg-neutral-950 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-2xl font-bold text-xs tracking-wider uppercase shadow-md active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
 >
 <Navigation className="w-4 h-4 text-blue-500" />
 <span>TRANSPORT & SET DROP-OFF</span>
 </button>
 </div>
 </div>
 )}

 {/* ========================================================= */}
 {/* 6. BOTTOM SHEET: TRANSPORTING TO DROP-OFF DESTINATION */}
 {/* ========================================================= */}
 {mode ==='transporting' && activeIncident && (
 <div className="absolute bottom-0 left-0 right-0 z-30 bg-white dark:bg-neutral-900 rounded-t-[28px] shadow-2xl p-5 border-t border-neutral-100 dark:border-neutral-800 animate-[fade-in_0.2s_ease-out]">
 <div className="w-10 h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full mx-auto mb-3" />

 <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
 <div>
 <span className="text-[10px] font-mono text-blue-600 font-bold uppercase tracking-wider">
 EN ROUTE TO DROP-OFF
 </span>
 <h3 className="text-base font-bold text-neutral-900 dark:text-white">
 {dropoffDestination?.name ||'Selected Drop-off Location'}
 </h3>
 <p className="text-xs text-neutral-500 dark:text-neutral-400">
 Patient transit &bull; {activeIncident.patientName}
 </p>
 </div>
 <button
 onClick={() => setShowDropoffModal(true)}
 className="px-2.5 py-1.5 bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
 >
 Change Destination
 </button>
 </div>

 <button
 onClick={handleCompleteHandover}
 className="w-full mt-4 py-4 bg-emerald-600 text-white rounded-2xl font-bold text-xs tracking-wider uppercase shadow-lg active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
 >
 <Check className="w-4 h-4" />
 <span>COMPLETE DROP-OFF & CLEAR UNIT</span>
 </button>
 </div>
 )}

 {/* ========================================================= */}
 {/* DROP-OFF DESTINATION SELECTION MODAL */}
 {/* ========================================================= */}
 {showDropoffModal && (
 <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-[fade-in_0.15s_ease-out]">
 <div className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white w-full sm:max-w-md rounded-t-[28px] sm:rounded-3xl shadow-2xl border-t sm:border border-neutral-200 dark:border-neutral-800 p-5 space-y-4 max-h-[85vh] overflow-y-auto">
 <div className="flex items-center justify-between pb-2 border-b border-neutral-100 dark:border-neutral-800">
 <div>
 <h3 className="font-bold text-base text-neutral-900 dark:text-white">
 Select Drop-off Destination
 </h3>
 <p className="text-xs text-neutral-500 dark:text-neutral-400">
 Where do you want to transfer or drop off the patient?
 </p>
 </div>
 <button
 onClick={() => setShowDropoffModal(false)}
 className="p-1.5 text-neutral-400 rounded-lg cursor-pointer"
 >
 <X className="w-5 h-5" />
 </button>
 </div>

 {/* Custom Location Name Input */}
 <div className="space-y-1.5">
 <label className="text-[11px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
 Drop-off Destination
 </label>
 <input
 type="text"
 value={customDropoffName}
 onChange={(e) => setCustomDropoffName(e.target.value)}
 placeholder="Enter destination, address, or facility name..."
 className="w-full px-3.5 py-3 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs font-semibold text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-blue-500"
 />
 <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
 You can specify any clinic, station, home, triage point, or custom drop-off destination.
 </p>
 </div>

 {/* Tap on Map Action */}
 <button
 onClick={() => {
 setShowDropoffModal(false);
 setIsPickingDropoffOnMap(true);
 }}
 className="w-full py-3 px-3.5 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900/40 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
 >
 <MapPin className="w-4 h-4 text-blue-600 dark:text-blue-400" />
 <span>Tap Map to Pin Destination</span>
 </button>

 {/* Confirm button if custom name typed */}
 {customDropoffName.trim() && (
 <button
 onClick={() => handleCommenceTransport({ name: customDropoffName.trim() })}
 className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-bold text-xs uppercase tracking-wider shadow-md active:scale-98 transition-all cursor-pointer"
 >
 Confirm Drop-off & Start Transport
 </button>
 )}
 </div>
 </div>
 )}

 {/* ========================================================= */}
 {/* 7. RESPONDER MESSENGER & COMMS APP MODAL */}
 {/* ========================================================= */}
 {isMessagesOpen && (
 <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-[fade-in_0.15s_ease-out]">
 <div className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white w-full sm:max-w-lg rounded-t-[28px] sm:rounded-3xl shadow-2xl border-t sm:border border-neutral-200 dark:border-neutral-800 flex flex-col h-[85vh] max-h-[720px] overflow-hidden">
 
 {/* Mobile Drag Indicator */}
 <div className="w-10 h-1 bg-neutral-300 dark:bg-neutral-700 rounded-full mx-auto mt-2.5 -mb-1 sm:hidden shrink-0" />

 {/* SCREEN 1: MESSENGER INBOX / CONTACTS LIST */}
 {!activeChatId ? (
 <div className="flex-1 flex flex-col overflow-hidden">
 {/* Inbox Header */}
 <div className="px-5 py-3.5 border-b border-neutral-100 dark:border-neutral-800/80 flex items-center justify-between shrink-0">
 <div className="flex items-center gap-2.5 min-w-0">
 <div className="w-8 h-8 rounded-full bg-rose-50 dark:bg-rose-950/40 text-[#B41A46] dark:text-rose-400 flex items-center justify-center text-xs font-semibold shrink-0">
 <MessageSquare className="w-4 h-4" />
 </div>
 <div className="min-w-0">
 <div className="flex items-center gap-1.5">
 <h3 className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-white truncate">
 Messages
 </h3>
 <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shrink-0" />
 </div>
 <p className="text-[11px] text-neutral-400 truncate mt-0.5">
 {callSign} · Citizen & Fleet Comms
 </p>
 </div>
 </div>

 <button
 onClick={() => setIsMessagesOpen(false)}
 className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-400 transition-colors cursor-pointer shrink-0"
 aria-label="Close"
 >
 <X className="w-4 h-4" />
 </button>
 </div>

 {/* Search Bar & Segmented Tabs */}
 <div className="p-3 border-b border-neutral-100 dark:border-neutral-800/80 bg-neutral-50/50 dark:bg-neutral-900/40 shrink-0 space-y-2">
 <div className="relative">
 <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
 <input
 type="text"
 value={chatSearchQuery}
 onChange={(e) => setChatSearchQuery(e.target.value)}
 placeholder="Search contacts or messages..."
 className="w-full pl-8 pr-7 py-2 bg-white dark:bg-neutral-800 border border-neutral-200/80 dark:border-neutral-700/60 rounded-xl text-xs font-normal text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-[#B41A46] transition-all"
 />
 {chatSearchQuery && (
 <button
 onClick={() => setChatSearchQuery('')}
 className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 text-xs cursor-pointer"
 >
 ✕
 </button>
 )}
 </div>

 {/* Minimal Segmented Tab */}
 <div className="flex items-center gap-1 p-0.5 bg-neutral-100 dark:bg-neutral-800/80 rounded-xl">
 {(['all','citizens','units'] as const).map(tab => (
 <button
 key={tab}
 type="button"
 onClick={() => setMessengerFilter(tab)}
 className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
 messengerFilter === tab
 ?'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs font-semibold'
 :'text-neutral-500 dark:text-neutral-400'
 }`}
 >
 {tab ==='all' ?'All' : tab ==='citizens' ?'Citizens' :'Fleet'}
 </button>
 ))}
 </div>
 </div>

 {/* Contacts & Conversations Stream */}
 <div className="flex-1 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800/60 p-1">
 {/* Citizen Contacts Threads */}
 {filteredDirectChats.map((chat) => {
 const isUnread = chat.lastMessageSender !== callSign;
 return (
 <div
 key={chat.id}
 onClick={() => {
 setActiveChatId(chat.id);
 setActiveChatRecipient({ id: chat.citizenId, name: chat.citizenName, type:'citizen', apparatus: chat.responderApparatus });
 }}
 className={`p-3 flex items-center gap-3 rounded-2xl cursor-pointer transition-colors ${
 isUnread ?'bg-rose-50/40 dark:bg-rose-950/20' :''
 }`}
 >
 <div className="relative shrink-0">
 <div className="w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 flex items-center justify-center font-semibold text-xs border border-neutral-200/60 dark:border-neutral-700/60">
 {chat.citizenName ? chat.citizenName.charAt(0).toUpperCase() :'C'}
 </div>
 <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-neutral-900 absolute bottom-0 right-0" />
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center justify-between mb-0.5">
 <div className="flex items-center gap-1.5 min-w-0">
 <span className="font-semibold text-xs truncate text-neutral-900 dark:text-white">
 {chat.citizenName ||'Citizen Caller'}
 </span>
 <span className="text-[10px] text-neutral-400">· Citizen</span>
 </div>
 <span className="text-[10px] text-neutral-400 font-sans shrink-0">
 {chat.lastMessageTime ||'Live'}
 </span>
 </div>
 <div className="flex items-center justify-between gap-2">
 <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
 {chat.lastMessageSender === callSign ? <span className="text-neutral-400">You: </span> :''}
 {chat.lastMessage ||'Direct channel established'}
 </p>
 {isUnread && (
 <span className="w-2 h-2 rounded-full bg-[#B41A46] shrink-0" />
 )}
 </div>
 </div>
 </div>
 );
 })}

 {/* Online Field Units */}
 {(messengerFilter ==='all' || messengerFilter ==='units') && filteredUnits.map((unit) => (
 <div
 key={unit.id}
 onClick={() => {
 const directId = getDirectChatId(userProfile?.uid ||`resp-${apparatus}`, unit.id);
 setActiveChatId(directId);
 setActiveChatRecipient({ id: unit.id, name: unit.callSign, type: unit.apparatus, phone: unit.phone });
 }}
 className="p-3 flex items-center gap-3 rounded-2xl cursor-pointer transition-colors"
 >
 <div className="w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 flex items-center justify-center text-sm shrink-0 border border-neutral-200/60 dark:border-neutral-700/60">
 {unit.apparatus ==='police' ?'🚓' : unit.apparatus ==='fire' ?'🚒' :'🚑'}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center justify-between mb-0.5">
 <span className="font-semibold text-xs truncate text-neutral-900 dark:text-white">
 {unit.callSign}
 </span>
 <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold uppercase">
 Online
 </span>
 </div>
 <p className="text-xs text-neutral-400 truncate capitalize">
 {unit.apparatus} · {unit.status}
 </p>
 </div>
 </div>
 ))}

 {/* Empty State */}
 {filteredDirectChats.length === 0 && (filteredUnits.length === 0 || messengerFilter ==='citizens') && (
 <div className="text-center py-12 px-4 text-neutral-400">
 <div className="w-9 h-9 rounded-2xl bg-neutral-100 dark:bg-neutral-800 mx-auto flex items-center justify-center text-neutral-400 mb-2">
 <MessageSquare className="w-4 h-4" />
 </div>
 <p className="font-semibold text-xs text-neutral-700 dark:text-neutral-300">No messages yet</p>
 <p className="text-[11px] text-neutral-400 mt-1 max-w-xs mx-auto">
 When a citizen or unit contacts {callSign}, conversations appear here.
 </p>
 </div>
 )}
 </div>
 </div>
 ) : (
 /* SCREEN 2: ACTIVE CONVERSATION THREAD */
 <div className="flex-1 flex flex-col overflow-hidden">
 {/* Conversation Header */}
 <div className="px-4 py-3.5 border-b border-neutral-100 dark:border-neutral-800/80 flex items-center justify-between shrink-0 bg-white dark:bg-neutral-900">
 <div className="flex items-center gap-2.5 min-w-0">
 <button
 onClick={() => setActiveChatId(null)}
 className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-500 dark:text-neutral-400 transition-colors cursor-pointer shrink-0"
 title="Back to contacts"
 >
 <ChevronLeft className="w-5 h-5" />
 </button>

 <div className="relative shrink-0">
 <div className="w-9 h-9 rounded-full bg-rose-50 dark:bg-rose-950/40 text-[#B41A46] dark:text-rose-400 flex items-center justify-center text-sm border border-rose-100 dark:border-rose-900/40">
 {activeChatRecipient?.type ==='police' ? (
'🚓'
 ) : activeChatRecipient?.type ==='fire' ? (
'🚒'
 ) : activeChatRecipient?.type ==='ambulance' ? (
'🚑'
 ) : (
 activeChatRecipient?.name?.charAt(0).toUpperCase() ||'C'
 )}
 </div>
 <span className="w-2 h-2 rounded-full bg-emerald-500 border border-white dark:border-neutral-900 absolute bottom-0 right-0" />
 </div>

 <div className="min-w-0">
 <h3 className="text-sm font-semibold tracking-tight leading-tight truncate text-neutral-900 dark:text-white">
 {activeChatRecipient?.name ||'Contact'}
 </h3>
 <p className="text-[11px] text-neutral-400 truncate flex items-center gap-1.5 mt-0.5">
 <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shrink-0" />
 <span>
 {activeChatRecipient?.type ==='citizen'
 ?'Citizen · Direct Channel'
 :`${activeChatRecipient?.type?.toUpperCase() ||'UNIT'} · Fleet Radio`}
 </span>
 </p>
 </div>
 </div>

 <div className="flex items-center gap-1.5 shrink-0">
 {activeChatRecipient?.phone && (
 <a
 href={`tel:${activeChatRecipient.phone}`}
 className="w-8 h-8 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400 transition-colors"
 title="Call contact"
 >
 <Phone className="w-4 h-4" />
 </a>
 )}
 <button
 onClick={() => setIsMessagesOpen(false)}
 className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-400 transition-colors cursor-pointer"
 aria-label="Close"
 >
 <X className="w-4 h-4" />
 </button>
 </div>
 </div>

 {/* Messages Stream */}
 <div 
 ref={responderChatScrollRef}
 className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-neutral-50/60 dark:bg-neutral-950/40"
 >
 {activeChatMessages.length === 0 ? (
 <div className="h-full flex flex-col items-center justify-center text-center p-6 text-neutral-400">
 <div className="w-9 h-9 rounded-2xl bg-neutral-100 dark:bg-neutral-800 mx-auto flex items-center justify-center text-neutral-400 mb-2">
 <MessageSquare className="w-4 h-4" />
 </div>
 <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
 Direct conversation with {activeChatRecipient?.name ||'Contact'}
 </p>
 <p className="text-[11px] text-neutral-400 mt-1 max-w-xs leading-relaxed">
 Send entrance notes, status updates, or tactical guidance directly to this contact.
 </p>
 </div>
 ) : (
 activeChatMessages.map((m) => {
 const isMe = m.senderRole ==='responder' || m.senderId === userProfile?.uid;
 return (
 <div key={m.id} className={`flex flex-col ${isMe ?'items-end' :'items-start'}`}>
 <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-neutral-400">
 <span>{isMe ?`${callSign} (You)` : m.senderName}</span>
 <span aria-hidden="true">·</span>
 <span>{m.timestamp}</span>
 </div>
 <div
 className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-xs font-normal leading-relaxed shadow-xs ${
 isMe
 ?'bg-[#B41A46] text-white rounded-br-xs'
 :'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border border-neutral-200/80 dark:border-neutral-700/80 rounded-bl-xs'
 }`}
 >
 {m.text}
 </div>
 </div>
 );
 })
 )}
 </div>

 {/* Message Input Footer */}
 <form
 onSubmit={(e) => {
 e.preventDefault();
 handleSendMessage();
 }}
 className="p-3 border-t border-neutral-100 dark:border-neutral-800/80 bg-white dark:bg-neutral-900 flex items-center gap-2 shrink-0"
 >
 <input
 type="text"
 value={messageInput}
 onChange={(e) => setMessageInput(e.target.value)}
 placeholder={`Message ${activeChatRecipient?.name ||'contact'}...`}
 className="flex-1 px-4 py-2.5 bg-neutral-100 dark:bg-neutral-800 border border-transparent focus:border-[#B41A46] focus:bg-white dark:focus:bg-neutral-900 rounded-full text-xs font-normal text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none transition-all"
 />
 <button
 type="submit"
 disabled={!messageInput.trim()}
 className="w-9 h-9 bg-[#B41A46] disabled:opacity-30 text-white rounded-full flex items-center justify-center transition-all shrink-0 cursor-pointer active:scale-95 shadow-xs"
 title="Send"
 >
 <Send className="w-3.5 h-3.5" />
 </button>
 </form>
 </div>
 )}
 </div>
 </div>
 )}
 </div>
 );
}
