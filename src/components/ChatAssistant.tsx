import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, Send, ArrowRight, AlertCircle } from 'lucide-react';
import { sendChatToGemini, ChatTriageMessage, TriageAssessment, fetchOnlineResponders, LiveOnlineResponder } from '../lib/api';
import { useUserSettings } from '../lib/userSettings';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToOnlineResponders } from '../lib/firebase';

interface ChatAssistantProps {
  initialMessage?: string;
  onBack: () => void;
  onNavigate?: (screen: string) => void;
  onTriggerSOS?: (serviceType?: string, triageReport?: string, targetUnit?: LiveOnlineResponder) => void;
}

interface Message {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  timestamp: string;
  action?: string;
  actionType?: 'ambulance' | 'police' | 'fire' | 'call';
  triage?: TriageAssessment;
}

function parseActionTag(text: string): { cleanText: string; action?: string; actionType?: 'ambulance' | 'police' | 'fire' | 'call' } {
  const match = text.match(/\[ACTION:\s*([^\]]+)\]/i);
  if (!match) {
    return { cleanText: text };
  }
  const actionLabel = match[1].trim();
  const cleanText = text.replace(/\[ACTION:\s*([^\]]+)\]/i, '').trim();
  
  let actionType: 'ambulance' | 'police' | 'fire' | 'call' = 'ambulance';
  const lower = actionLabel.toLowerCase();
  if (lower.includes('police') || lower.includes('law') || lower.includes('patrol')) actionType = 'police';
  else if (lower.includes('fire') || lower.includes('rescue')) actionType = 'fire';
  else if (lower.includes('call') || lower.includes('hotline')) actionType = 'call';

  return { cleanText, action: actionLabel, actionType };
}

export default function ChatAssistant({ initialMessage, onBack, onNavigate, onTriggerSOS }: ChatAssistantProps) {
  const { settings } = useUserSettings();
  const { userProfile } = useAuth();
  const { profile, location, darkMode } = settings;

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'bot',
      text: "Hello, I'm Serdy. What symptoms or emergency situation are you experiencing?",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [onlineResponders, setOnlineResponders] = useState<LiveOnlineResponder[]>([]);
  const [onlineCount, setOnlineCount] = useState<number>(0);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const hasSentInitialRef = useRef(false);

  useEffect(() => {
    let isSubscribed = true;

    const mergeResponders = (baseList: LiveOnlineResponder[]) => {
      const combinedMap = new Map<string, LiveOnlineResponder>();
      baseList.forEach(r => {
        if (r && r.status !== 'offline') combinedMap.set(r.id, r);
      });

      try {
        const localCached = localStorage.getItem('serd_latest_online_responder');
        if (localCached) {
          const parsed = JSON.parse(localCached);
          if (parsed && parsed.id && parsed.status !== 'offline') {
            const age = Date.now() - (parsed.timestamp || 0);
            if (age < 3600000) {
              combinedMap.set(parsed.id, { ...(combinedMap.get(parsed.id) || {}), ...parsed });
            }
          }
        }
      } catch {}

      return Array.from(combinedMap.values());
    };

    const unsub = subscribeToOnlineResponders((fleet) => {
      if (isSubscribed && fleet) {
        const merged = mergeResponders(fleet);
        setOnlineResponders(merged);
        setOnlineCount(merged.length);
      }
    });

    fetchOnlineResponders().then(list => {
      if (isSubscribed && list) {
        const merged = mergeResponders(list);
        setOnlineResponders(merged);
        setOnlineCount(merged.length);
      }
    });

    return () => {
      isSubscribed = false;
      unsub();
    };
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const executeSend = async (textToSend: string) => {
    if (!textToSend.trim() || isLoading) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: textToSend.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsLoading(true);

    const historyPayload: ChatTriageMessage[] = newMessages.map(m => ({
      role: m.sender === 'bot' ? 'assistant' : 'user',
      text: m.text
    }));

    const contextPayload = {
      callerName: userProfile?.fullName || profile?.fullName || profile?.displayName || 'Citizen',
      location: location?.lastKnownAddress || 'Current GPS coordinates',
      bloodType: userProfile?.bloodType || profile?.bloodType || 'Unknown',
      allergies: (userProfile?.allergies || profile?.allergies || []).map(a => typeof a === 'string' ? a : a.allergen)
    };

    const response = await sendChatToGemini(historyPayload, contextPayload);
    setIsLoading(false);

    const { cleanText, action, actionType } = parseActionTag(response.text);

    const botMsg: Message = {
      id: `bot-${Date.now()}`,
      sender: 'bot',
      text: response.guidance || cleanText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      action: response.triage?.dispatchLabel || action,
      actionType: (response.triage?.recommendedService as any) || actionType,
      triage: response.triage
    };

    setMessages(prev => [...prev, botMsg]);
  };

  useEffect(() => {
    if (initialMessage && !hasSentInitialRef.current) {
      hasSentInitialRef.current = true;
      executeSend(initialMessage);
    }
  }, [initialMessage]);

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim() || isLoading) return;
    const text = inputValue;
    setInputValue('');
    executeSend(text);
  };

  const handleExecuteAction = (actionType?: string, currentMsg?: Message) => {
    let activeUnits = [...onlineResponders].filter(r => r.status !== 'offline');
    if (activeUnits.length === 0) {
      try {
        const localCached = localStorage.getItem('serd_latest_online_responder');
        if (localCached) {
          const parsed = JSON.parse(localCached);
          if (parsed && parsed.id && parsed.status !== 'offline') {
            activeUnits = [parsed];
          }
        }
      } catch {}
    }

    if (activeUnits.length === 0 && onlineCount === 0) {
      setNoticeMessage('Cannot dispatch: No emergency responders are currently online. Please dial local emergency hotlines directly.');
      return;
    }
    setNoticeMessage(null);

    const reqService = (actionType === 'police' || actionType === 'ambulance' || actionType === 'fire')
      ? actionType
      : 'ambulance';

    // Find best target unit: preferred matching service, or nearest active unit
    const targetUnit = activeUnits.find(r => r.apparatus === reqService && r.status !== 'offline')
      || activeUnits.find(r => r.status !== 'offline')
      || activeUnits[0];

    // Find the latest citizen symptom/emergency message
    const lastUserMsg = [...messages].reverse().find(m => m.sender === 'user')?.text || '';
    const triage = currentMsg?.triage;

    let triageReport = '';
    if (triage) {
      triageReport = `🚨 WHAT'S WRONG / TRIAGE REPORT:\n• Condition: ${triage.urgencyLabel || triage.urgency} (${triage.chiefComplaint || 'Emergency Triage'})\n• Caller Symptoms: "${lastUserMsg || 'Emergency help requested'}"\n• Serdy Guidance: ${currentMsg?.text || ''}`;
      if (triage.firstAidSteps && triage.firstAidSteps.length > 0) {
        triageReport += `\n• First-Aid Applied: ${triage.firstAidSteps.join('; ')}`;
      }
    } else {
      triageReport = `🚨 WHAT'S WRONG / EMERGENCY REPORT:\n• Caller Symptoms: "${lastUserMsg || 'Emergency situation reported'}"\n• Action Needed: ${currentMsg?.action || 'Immediate emergency dispatch'}\n• Serdy Guidance: ${currentMsg?.text || ''}`;
    }

    if (onTriggerSOS) {
      onTriggerSOS(reqService, triageReport, targetUnit);
    } else if (onNavigate) {
      onNavigate('map');
    } else {
      onBack();
    }
  };

  return (
    <div className={`flex flex-col h-full font-sans select-none relative ${
      darkMode ? 'bg-neutral-950 text-neutral-100' : 'bg-[#FAFAFA] text-neutral-900'
    }`}>
      {/* Notice Alert if no responders online */}
      {noticeMessage && (
        <div 
          className="absolute left-4 right-4 z-40 bg-neutral-900 text-white rounded-2xl p-3 shadow-xl border border-neutral-800 flex items-center justify-between text-xs font-semibold animate-[fade-in_0.2s_ease-out]"
          style={{ top: 'calc(max(env(safe-area-inset-top, 0px), 14px) + 52px)' }}
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{noticeMessage}</span>
          </div>
          <button 
            type="button" 
            onClick={() => setNoticeMessage(null)}
            className="ml-2 text-neutral-400 active:text-white px-1 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Clean Minimal Header with Safe-Area Whitespace */}
      <header 
        className={`shrink-0 px-4 pb-3 flex items-center justify-between border-b ${
          darkMode ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-neutral-200/80'
        }`}
        style={{
          paddingTop: 'calc(max(env(safe-area-inset-top, 0px), 14px) + 8px)'
        }}
      >
        <div className="flex items-center gap-2">
          <button 
            type="button"
            onClick={onBack} 
            className={`p-1.5 -ml-1 rounded-lg transition-colors cursor-pointer active:scale-95 ${
              darkMode 
                ? 'active:bg-neutral-800 text-neutral-300' 
                : 'active:bg-neutral-100 text-neutral-700'
            }`}
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div>
            <h1 className="font-semibold text-sm leading-tight text-neutral-900 dark:text-white">
              Serdy
            </h1>
            <p className="text-[11px] text-neutral-400 dark:text-neutral-500 leading-none mt-0.5">
              Emergency Triage &bull; google/gemma-3-4b-it
            </p>
          </div>
        </div>
      </header>

      {/* Message Thread */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => {
          const isBot = msg.sender === 'bot';
          const hasAction = (msg.triage?.dispatchNeeded && msg.triage?.dispatchLabel) || Boolean(msg.action);

          return (
            <div 
              key={msg.id} 
              className={`flex flex-col ${isBot ? 'items-start' : 'items-end'}`}
            >
              {/* Message Bubble */}
              <div 
                className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed ${
                  isBot 
                    ? darkMode
                      ? 'bg-neutral-900 border border-neutral-800 text-neutral-200 rounded-tl-xs'
                      : 'bg-white border border-neutral-200/70 text-neutral-800 rounded-tl-xs'
                    : 'bg-[#B41A46] text-white rounded-tr-xs'
                }`}
              >
                <p className="whitespace-pre-wrap font-normal select-text">
                  {msg.text}
                </p>

                {/* Structured Clinical Triage Details (if detected) */}
                {isBot && msg.triage && (
                  <div className="mt-2.5 pt-2 border-t border-neutral-100 dark:border-neutral-800 space-y-2">
                    {/* Urgency Badge & Chief Complaint */}
                    {msg.triage.chiefComplaint && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                          msg.triage.urgency === 'P1_CRITICAL'
                            ? 'bg-rose-100 text-[#B41A46] dark:bg-rose-950/70 dark:text-rose-300'
                            : msg.triage.urgency === 'P2_URGENT'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                            : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
                        }`}>
                          {msg.triage.urgencyLabel || msg.triage.urgency}
                        </span>
                        <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                          {msg.triage.chiefComplaint}
                        </span>
                      </div>
                    )}

                    {/* Numbered First-Aid Actions */}
                    {msg.triage.firstAidSteps && msg.triage.firstAidSteps.length > 0 && (
                      <div className="space-y-1 pt-1">
                        {msg.triage.firstAidSteps.map((step, idx) => (
                          <div key={idx} className="flex items-start gap-1.5 text-xs text-neutral-700 dark:text-neutral-300 leading-snug">
                            <span className="font-semibold text-neutral-400 text-[10px] shrink-0 mt-0.5">{idx + 1}.</span>
                            <span>{step}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Precaution / Hazard Warning */}
                    {msg.triage.precautions && msg.triage.precautions.length > 0 && (
                      <div className="space-y-0.5 pt-0.5">
                        {msg.triage.precautions.map((p, idx) => (
                          <p key={idx} className="text-[11px] text-amber-700 dark:text-amber-400 leading-tight">
                            &bull; {p}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Structured Triage Action Button */}
                {isBot && hasAction && (
                  <div className={`mt-3 pt-2.5 border-t ${
                    darkMode ? 'border-neutral-800' : 'border-neutral-100'
                  }`}>
                    <button 
                      type="button"
                      onClick={() => handleExecuteAction(msg.triage?.recommendedService || msg.actionType, msg)}
                      className="w-full py-2 px-3 bg-[#B41A46] text-white font-medium text-xs rounded-xl transition-all active:scale-98 flex items-center justify-between cursor-pointer"
                    >
                      <span>{msg.triage?.dispatchLabel || msg.action}</span>
                      <ArrowRight className="w-3.5 h-3.5 opacity-80" />
                    </button>
                  </div>
                )}
              </div>

              {/* Timestamp */}
              <span className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1 px-1">
                {msg.timestamp}
              </span>
            </div>
          );
        })}

        {/* Minimal Loading State */}
        {isLoading && (
          <div className="flex items-start">
            <div className={`px-3 py-2 rounded-xl text-xs flex items-center gap-1.5 ${
              darkMode ? 'bg-neutral-900 text-neutral-400 border border-neutral-800' : 'bg-white text-neutral-500 border border-neutral-200/70'
            }`}>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#B41A46] animate-pulse" />
              <span className="text-[11px]">Serdy is triaging...</span>
            </div>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      {/* Input Composer */}
      <footer className={`p-3 sm:p-4 border-t shrink-0 ${
        darkMode ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-neutral-200/70'
      }`}>
        <form 
          onSubmit={handleSend} 
          className={`flex items-center gap-2 rounded-xl px-3 py-1.5 border transition-all ${
            darkMode 
              ? 'bg-neutral-950 border-neutral-800 focus-within:border-[#B41A46]' 
              : 'bg-neutral-50 border-neutral-200 focus-within:border-[#B41A46] focus-within:bg-white'
          }`}
        >
          <input 
            type="text" 
            placeholder="Type what happened..." 
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isLoading}
            className="flex-1 bg-transparent border-none focus:outline-none text-xs sm:text-sm text-neutral-900 dark:text-white py-1 placeholder:text-neutral-400"
          />
          <button 
            type="submit"
            disabled={!inputValue.trim() || isLoading} 
            className="w-7 h-7 bg-[#B41A46] rounded-lg flex items-center justify-center text-white transition-all disabled:opacity-30 cursor-pointer shrink-0 active:scale-95"
            aria-label="Send"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </footer>
    </div>
  );
}
