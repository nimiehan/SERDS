import React, { useState, useRef, useEffect } from 'react';
import { Phone, AlertCircle } from 'lucide-react';
import { Screen } from '../types';
import { useUserSettings } from '../lib/userSettings';
import { useAuth } from '../contexts/AuthContext';
import { createEmergencyIncident, fetchOnlineResponders, LiveOnlineResponder } from '../lib/api';
import { subscribeToOnlineResponders } from '../lib/firebase';
import { calculateDistance } from '../lib/routing';

interface HomeProps {
  onSOSClick: (autoDispatch?: boolean, incidentId?: string, targetUnit?: LiveOnlineResponder) => void;
  onChatClick: (message?: string) => void;
  onNavigate: (screen: Screen | any) => void;
}

export default function Home({ onSOSClick, onChatClick, onNavigate }: HomeProps) {
  const { currentUser, userProfile } = useAuth();
  const { settings } = useUserSettings();
  const { profile, location } = settings;

  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0); // 0 to 100
  const [onlineResponders, setOnlineResponders] = useState<LiveOnlineResponder[]>([]);
  const [alertNotice, setAlertNotice] = useState<string | null>(null);
  const [calling911, setCalling911] = useState<boolean>(false);

  const progressAnimRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // Subscribe to real online responders in real time
  useEffect(() => {
    let isSubscribed = true;
    const unsub = subscribeToOnlineResponders((fleet) => {
      if (isSubscribed && fleet) {
        setOnlineResponders(fleet.filter(r => r.status !== 'offline'));
      }
    });

    // Also fetch via HTTP API
    fetchOnlineResponders().then(list => {
      if (isSubscribed && list) {
        setOnlineResponders(prev => {
          const map = new Map<string, LiveOnlineResponder>();
          prev.forEach(r => map.set(r.id, r));
          list.forEach(r => {
            if (r.status !== 'offline') map.set(r.id, r);
          });
          return Array.from(map.values());
        });
      }
    });

    return () => {
      isSubscribed = false;
      unsub();
    };
  }, []);

  const cleanUpHold = () => {
    if (progressAnimRef.current) {
      cancelAnimationFrame(progressAnimRef.current);
      progressAnimRef.current = null;
    }
    startTimeRef.current = null;
    setHoldProgress(0);
    setIsHolding(false);
  };

  const startHold = (e: React.MouseEvent | React.TouchEvent) => {
    if ('button' in e && e.button !== 0) return;

    setAlertNotice(null);
    setIsHolding(true);
    startTimeRef.current = Date.now();

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(40);
      } catch {}
    }

    const animateProgress = () => {
      if (!startTimeRef.current) return;
      const elapsed = Date.now() - startTimeRef.current;
      const pct = Math.min(100, (elapsed / 3000) * 100);
      setHoldProgress(pct);

      if (pct >= 100) {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate([100, 50, 150]);
          } catch {}
        }
        cleanUpHold();

        const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
        const noUnitsOnline = onlineResponders.length === 0;

        // REQUIREMENT: when either no unit online or offline mode. auto call 911
        if (isOffline || noUnitsOnline) {
          setCalling911(true);
          try {
            window.location.href = 'tel:911';
          } catch (err) {
            console.error('Failed to trigger tel:911', err);
          }
          return;
        }

        // Dispatch emergency report using real user GPS location
        let realCoords: [number, number] | undefined = undefined;
        if (location?.lastKnownCoords) {
          realCoords = [location.lastKnownCoords.lat, location.lastKnownCoords.lng];
        } else {
          try {
            const cached = sessionStorage.getItem('serd_real_user_location') || localStorage.getItem('serd_real_user_location');
            if (cached) realCoords = JSON.parse(cached);
          } catch {}
        }

        // REQUIREMENT: Dispatch the NEAREST unit of ANY service (police, ambulance, fire)
        const activeUnits = [...onlineResponders].filter(r => r.status !== 'offline');
        let nearestUnit: LiveOnlineResponder = activeUnits[0];

        if (realCoords && realCoords[0] && activeUnits.length > 1) {
          activeUnits.sort((a, b) => {
            const da = calculateDistance(realCoords[0], realCoords[1], a.coords[0], a.coords[1]);
            const db = calculateDistance(realCoords[0], realCoords[1], b.coords[0], b.coords[1]);
            return da - db;
          });
          nearestUnit = activeUnits[0];
        }

        createEmergencyIncident({
          type: 'General SOS Alert',
          location: location.lastKnownAddress || 'Current GPS Location',
          patientName: (resolvedFullName && resolvedFullName.length > 1 ? resolvedFullName : greetingName) || 'Citizen Caller',
          priority: 'critical',
          coords: realCoords,
          service: nearestUnit ? nearestUnit.apparatus : 'ambulance',
          targetResponderId: nearestUnit ? nearestUnit.id : undefined,
          recommendedUnit: nearestUnit ? nearestUnit.callSign : 'Nearest Responder Unit',
          details: nearestUnit 
            ? `SOS Triggered: Nearest unit ${nearestUnit.callSign} (${nearestUnit.apparatus.toUpperCase()}) targeted` 
            : 'SOS Triggered: Emergency Patrol Dispatch',
          isGeneralSos: true
        }).then((created) => {
          onSOSClick(true, created?.id, nearestUnit);
        }).catch(() => {
          onSOSClick(true, undefined, nearestUnit);
        });
      } else {
        progressAnimRef.current = requestAnimationFrame(animateProgress);
      }
    };

    progressAnimRef.current = requestAnimationFrame(animateProgress);
  };

  const stopHold = () => {
    cleanUpHold();
  };

  const RING_RADIUS = 64;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  const ringOffset = RING_CIRCUMFERENCE - (holdProgress / 100) * RING_CIRCUMFERENCE;

  // Authoritative name resolution: prioritizes Firebase profile, local profile, auth user, and email
  const resolvedFullName = (userProfile?.fullName || profile.fullName || currentUser?.displayName || '').trim();
  const rawDisplayName = (userProfile?.displayName || profile.displayName || '').trim();
  const greetingName = (() => {
    if (rawDisplayName && rawDisplayName.length > 1) return rawDisplayName;
    if (resolvedFullName && resolvedFullName.length > 1) {
      const parts = resolvedFullName.split(/\s+/);
      if (parts[0] && parts[0].length > 1) return parts[0];
      return resolvedFullName;
    }
    const email = currentUser?.email || userProfile?.email || profile.email;
    if (email && email.includes('@')) {
      const emailUser = email.split('@')[0].replace(/[0-9_.-]+/g, ' ').trim();
      if (emailUser.length > 1) {
        return emailUser.split(/\s+/)[0].replace(/^./, c => c.toUpperCase());
      }
    }
    if (rawDisplayName) return rawDisplayName;
    return 'Citizen';
  })();

  return (
    <div className="flex flex-col h-full bg-[#FAFAFA] text-gray-900 px-6 pt-5 pb-4 font-sans select-none overflow-hidden relative">
      {/* Sub-header User & Location Context (Page 22) */}
      <div className="flex justify-between items-center pt-1 pb-5 text-xs">
        <div>
          <p className="font-semibold text-gray-900 text-sm leading-tight">
            Hello, {greetingName}
          </p>
        </div>

        <div className="text-right">
          <p className="font-semibold text-gray-900 text-sm leading-tight truncate max-w-[160px]" title={location.lastKnownAddress || 'Current GPS Location'}>
            {location.lastKnownAddress || 'Current GPS Location'}
          </p>
        </div>
      </div>

      {/* Floating Notice Banner */}
      {alertNotice && (
        <div className="absolute top-4 left-4 right-4 z-40 bg-neutral-900 text-white rounded-2xl p-3.5 shadow-xl flex items-center justify-between text-xs font-semibold animate-[fade-in_0.2s_ease-out]">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{alertNotice}</span>
          </div>
          <button 
            type="button" 
            onClick={() => setAlertNotice(null)} 
            className="ml-2 px-1.5 py-0.5 rounded text-neutral-400 active:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* 911 Auto-Calling Modal */}
      {calling911 && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-[fade-in_0.15s_ease-out]">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm text-center shadow-2xl border border-rose-100 flex flex-col items-center">
            <div className="w-16 h-16 rounded-full bg-rose-100 text-[#B41A46] flex items-center justify-center mb-4 animate-pulse">
              <Phone className="w-8 h-8 fill-current" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">Calling 911</h3>
            <p className="text-xs text-gray-500 mb-6 leading-relaxed">
              No field units online or offline mode detected. Direct telephone line to 911 emergency services has been placed.
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
                className="w-full py-2.5 rounded-2xl bg-gray-100 text-gray-700 font-semibold text-xs active:bg-gray-200 transition-all cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Action Area (Page 22 UI Design 4) */}
      <div className="flex-1 flex flex-col items-center justify-center -mt-4">
        <h2 className="text-[28px] font-semibold text-gray-900 leading-tight text-center tracking-tight mb-2">
          Emergency Help<br />Needed?
        </h2>
        
        <p className="text-gray-400 text-xs tracking-wide mb-6">
          {isHolding ? 'Hold to confirm emergency call...' : 'Just hold the button to call'}
        </p>

        {/* Circular Press-and-Hold Button with Outer Soft Ring (Page 22) */}
        <div className="relative flex items-center justify-center w-64 h-64 select-none touch-none">
          {/* Outer Soft Pink Ring - Always active */}
          <div className={`absolute w-56 h-56 rounded-full bg-[#F9E8EC] transition-transform duration-300 ${
            isHolding ? 'scale-105' : ''
          }`} />

          {/* Progress SVG Ring */}
          <svg className="absolute w-44 h-44 -rotate-90 pointer-events-none z-20">
            <circle
              cx="88"
              cy="88"
              r={RING_RADIUS}
              fill="transparent"
              stroke="#B41A46"
              strokeWidth="4"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={ringOffset}
              strokeLinecap="round"
              className={isHolding ? 'transition-none' : 'transition-all duration-200'}
            />
          </svg>

          {/* Red Emergency Trigger Button - Always active */}
          <div
            onMouseDown={startHold}
            onMouseUp={stopHold}
            onMouseLeave={stopHold}
            onTouchStart={startHold}
            onTouchEnd={stopHold}
            onContextMenu={(e) => e.preventDefault()}
            className={`relative w-28 h-28 rounded-full flex items-center justify-center shadow-lg select-none transition-transform duration-200 bg-[#B41A46] cursor-pointer shadow-rose-900/20 active:scale-95 ${
              isHolding ? 'scale-95' : ''
            }`}
            title="Hold to call emergency"
          >
            <Phone className="w-10 h-10 text-white fill-current" />
          </div>
        </div>

        {/* "Not Sure What To Do" Option Matching Paper Page 22 */}
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => onChatClick()}
            className="flex flex-col items-center justify-center p-2 rounded-xl active:scale-95 transition-all"
          >
            <span className="text-xs font-semibold text-gray-800 transition-colors">
              Not Sure What To Do
            </span>
            <span className="text-[11px] text-gray-400 transition-colors">
              Ask Serdy for triage...
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
