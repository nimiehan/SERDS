import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  signInAnonymously,
  User 
} from "firebase/auth";
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs,
  getDocFromServer,
  addDoc, 
  updateDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  limit, 
  serverTimestamp,
  Timestamp
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase using the provisioned configuration
export { firebaseConfig };
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
// CRITICAL: The app will break without specifying the firestoreDatabaseId
export const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

// -------------------------------------------------------------
// Hardened Firestore Error Handler
// -------------------------------------------------------------
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Recursively removes undefined properties so setDoc/addDoc/updateDoc never fails
 * with 'Unsupported field value: undefined'
 */
export function cleanFirestoreData<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }
  if (Array.isArray(data)) {
    return data
      .filter((item) => item !== undefined)
      .map((item) => cleanFirestoreData(item)) as unknown as T;
  }
  if (typeof data === 'object') {
    if (
      data instanceof Date || 
      typeof (data as any).toMillis === 'function' || 
      (data as any)._methodName ||
      (data as any).constructor?.name === 'FieldValue'
    ) {
      return data;
    }
    const cleaned: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        cleaned[key] = cleanFirestoreData(val);
      }
    }
    return cleaned as T;
  }
  return data;
}

// Validate connection to Firestore on initialization
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

// -------------------------------------------------------------
// Data Types
// -------------------------------------------------------------
export interface FirestoreIncident {
  id?: string;
  code: string;
  type: string;
  priority: 'critical' | 'urgent' | 'standard';
  location: string;
  reportedTime: string;
  patientName: string;
  recommendedUnit?: string;
  service?: 'ambulance' | 'police' | 'fire';
  targetResponderId?: string;
  acceptedUnit?: string;
  declinedBy?: string[];
  distanceKm?: number;
  etaMins?: number;
  routeAlgorithm?: string;
  status: 'pending' | 'dispatched' | 'en_route' | 'on_scene' | 'cancelled' | 'completed';
  coords: [number, number];
  details?: string;
  createdAt?: any;
  isGeneralSos?: boolean;
}

export interface FirestoreUserProfile {
  uid: string;
  fullName: string;
  displayName: string;
  email: string;
  phone?: string;
  bloodType?: string;
  birthdate?: string;
  heightCm?: number;
  weightKg?: number;
  allergies?: Array<{ id: string; allergen: string; reaction: string; severity: string }>;
  emergencyContact?: {
    name: string;
    relation: string;
    phone: string;
  };
  emergencyCircle?: Array<{
    id: string;
    name: string;
    phone: string;
    relation: string;
    isPrimary?: boolean;
    notes?: string;
  }>;
  role?: 'citizen' | 'responder';
  agency?: string;
  badgeNumber?: string;
  responderRole?: string;
  station?: string;
  vehicleUnit?: string;
  callSign?: string;
  avatarUrl?: string;
  updatedAt?: any;
}

/**
 * Real-time listener for CAD Emergency Incidents
 */
export function subscribeToIncidents(callback: (incidents: FirestoreIncident[]) => void) {
  const path = "incidents";
  try {
    const q = query(
      collection(db, path),
      orderBy("createdAt", "desc"),
      limit(50)
    );

    return onSnapshot(q, (snapshot) => {
      const list: FirestoreIncident[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          code: data.code || '10-79',
          type: data.type || 'General Emergency SOS',
          priority: data.priority || 'critical',
          location: data.location || 'Unknown Location',
          reportedTime: data.reportedTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          patientName: data.patientName || 'Citizen Caller',
          recommendedUnit: data.recommendedUnit || 'Assigned Responder Unit',
          service: data.service,
          targetResponderId: data.targetResponderId,
          acceptedUnit: data.acceptedUnit,
          declinedBy: Array.isArray(data.declinedBy) ? data.declinedBy : [],
          distanceKm: data.distanceKm || 0.8,
          etaMins: data.etaMins || 2.0,
          routeAlgorithm: data.routeAlgorithm || 'OSRM Road Graph',
          status: data.status || 'dispatched',
          coords: data.coords || [0, 0],
          details: data.details || '',
          createdAt: data.createdAt
        };
      });
      callback(list);
    }, (error) => {
      console.warn("[Firestore] Incidents listener error:", error.message);
      handleFirestoreError(error, OperationType.GET, path);
    });
  } catch (err) {
    console.warn("[Firestore] Error initiating incidents listener:", err);
    return () => {};
  }
}

/**
 * Save new emergency dispatch to Firestore.
 * Supports customId to ensure unified ID across Firestore, Express, and clients.
 */
export async function saveIncidentToFirestore(
  incident: Omit<FirestoreIncident, 'id' | 'createdAt'>,
  customId?: string
): Promise<string | null> {
  const path = "incidents";
  try {
    const payload = cleanFirestoreData({
      ...incident,
      createdAt: serverTimestamp(),
      reportedTime: incident.reportedTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    if (customId) {
      const docRef = doc(db, path, customId);
      await setDoc(docRef, payload);
      return customId;
    } else {
      const docRef = await addDoc(collection(db, path), payload);
      return docRef.id;
    }
  } catch (err: any) {
    console.warn("[Firestore] Failed to save incident to Firestore:", err.message);
    handleFirestoreError(err, OperationType.CREATE, path);
    return null;
  }
}

/**
 * Update incident status in Firestore
 */
export async function updateFirestoreIncidentStatus(
  incidentId: string, 
  status: FirestoreIncident['status'],
  extra?: Partial<Omit<FirestoreIncident, 'status'>>
): Promise<boolean> {
  const path = `incidents/${incidentId}`;
  try {
    const updatePayload = cleanFirestoreData({
      status,
      ...extra,
      updatedAt: serverTimestamp()
    });

    const ref = doc(db, "incidents", incidentId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, updatePayload);
      return true;
    }

    // Fallback: If not found by direct doc ID, check if there is an incident with this code or ID in fields
    const q = query(collection(db, "incidents"), limit(25));
    const allSnaps = await getDocs(q);
    for (const d of allSnaps.docs) {
      const data = d.data();
      if (d.id === incidentId || data.id === incidentId || data.code === incidentId) {
        await updateDoc(d.ref, updatePayload);
        return true;
      }
    }

    return false;
  } catch (err) {
    console.warn("[Firestore] Failed to update incident status:", err);
    return false;
  }
}

/**
 * Handle responder declining an incident in Firestore:
 * - Records responderId and callSign into declinedBy
 * - Looks for candidate units with the same apparatus
 * - Reassigns to next available unit if present, otherwise marks as cancelled with 911 alert
 */
export async function declineFirestoreIncident(
  incidentId: string,
  responderInfo: {
    responderId?: string;
    callSign?: string;
    apparatus?: string;
  },
  availableFleet?: Array<{ id: string; callSign: string; apparatus: string; status?: string }>
): Promise<{ nextUnit?: any; allDeclined: boolean }> {
  try {
    const ref = doc(db, "incidents", incidentId);
    let targetDocSnap = await getDoc(ref);
    let docRefToUpdate = ref;

    if (!targetDocSnap.exists()) {
      const q = query(collection(db, "incidents"), limit(25));
      const allSnaps = await getDocs(q);
      for (const d of allSnaps.docs) {
        const data = d.data();
        if (d.id === incidentId || data.id === incidentId || data.code === incidentId) {
          targetDocSnap = d;
          docRefToUpdate = d.ref;
          break;
        }
      }
    }

    if (!targetDocSnap.exists()) {
      return { allDeclined: true };
    }

    const data = targetDocSnap.data();
    const existingDeclined = Array.isArray(data.declinedBy) ? data.declinedBy : [];
    const newDeclined = [...existingDeclined];
    if (responderInfo.responderId && !newDeclined.includes(responderInfo.responderId)) {
      newDeclined.push(responderInfo.responderId);
    }
    if (responderInfo.callSign && !newDeclined.includes(responderInfo.callSign)) {
      newDeclined.push(responderInfo.callSign);
    }

    const serviceType = data.service || responderInfo.apparatus || 'ambulance';
    const isGeneralSos = Boolean(data.isGeneralSos);

    // Filter available candidate units of the same apparatus (or any if general SOS)
    let candidateUnits: Array<{ id: string; callSign: string; apparatus: string; status?: string }> = [];
    if (availableFleet && availableFleet.length > 0) {
      candidateUnits = availableFleet.filter(r => {
        if (r.status === 'offline') return false;
        if (!isGeneralSos && r.apparatus !== serviceType) return false;
        const matchesDeclined = newDeclined.some(d =>
          String(d).toLowerCase() === String(r.id).toLowerCase() ||
          String(d).toLowerCase() === String(r.callSign).toLowerCase()
        );
        return !matchesDeclined;
      });
    }

    if (candidateUnits.length > 0) {
      const nextUnit = candidateUnits[0];
      await updateDoc(docRefToUpdate, cleanFirestoreData({
        declinedBy: newDeclined,
        targetResponderId: nextUnit.id,
        recommendedUnit: nextUnit.callSign,
        service: nextUnit.apparatus,
        status: 'dispatched',
        details: `Auto-reassigned to ${nextUnit.callSign}`,
        updatedAt: serverTimestamp()
      }));
      return { nextUnit, allDeclined: false };
    } else {
      await updateDoc(docRefToUpdate, cleanFirestoreData({
        declinedBy: newDeclined,
        status: 'cancelled',
        details: 'All units declined - auto call 911',
        updatedAt: serverTimestamp()
      }));
      return { allDeclined: true };
    }
  } catch (err) {
    console.warn("[Firestore] Failed to decline incident in Firestore:", err);
    return { allDeclined: true };
  }
}

/**
 * Marks all pending or dispatched stale incidents as completed.
 */
export async function clearAllStaleIncidents(): Promise<number> {
  const path = "incidents";
  try {
    const colRef = collection(db, path);
    const snap = await getDocs(colRef);
    let count = 0;
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      if (data.status === 'dispatched' || data.status === 'pending' || data.status === 'en_route' || data.status === 'on_scene') {
        try {
          await updateDoc(docSnap.ref, {
            status: 'completed',
            updatedAt: serverTimestamp()
          });
          count++;
        } catch {}
      }
    }
    return count;
  } catch (err) {
    console.warn("[Firestore] Error clearing stale incidents:", err);
    return 0;
  }
}

/**
 * Sync user profile to Firestore
 */
export async function syncUserProfileToFirestore(profile: FirestoreUserProfile): Promise<boolean> {
  const path = `users/${profile.uid}`;
  try {
    const ref = doc(db, "users", profile.uid);
    const sanitized = cleanFirestoreData({
      ...profile,
      updatedAt: serverTimestamp()
    });
    await setDoc(ref, sanitized, { merge: true });
    return true;
  } catch (err) {
    console.warn("[Firestore] Failed to sync user profile:", err);
    handleFirestoreError(err, OperationType.WRITE, path);
    return false;
  }
}

/**
 * Fetch user profile from Firestore
 */
export async function fetchUserProfileFromFirestore(uid: string): Promise<FirestoreUserProfile | null> {
  const path = `users/${uid}`;
  try {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as FirestoreUserProfile;
    }
  } catch (err) {
    console.warn("[Firestore] Failed to fetch user profile:", err);
    handleFirestoreError(err, OperationType.GET, path);
  }
  return null;
}



export const DEFAULT_SYSTEM_ALLERGENS: string[] = [
  'Penicillin / Amoxicillin',
  'Cephalosporins (Keflex, Rocephin)',
  'Sulfa Drugs (Bactrim, Septra)',
  'Aspirin / NSAIDs (Ibuprofen, Naproxen)',
  'Opioids (Morphine, Codeine, Tramadol)',
  'Iodine / Radiocontrast Dye',
  'Local Anesthetics (Lidocaine, Novocaine)',
  'General Anesthetics (Propofol, Ketamine)',
  'Fluoroquinolones (Ciprofloxacin, Levofloxacin)',
  'Macrolides (Azithromycin, Erythromycin)',
  'Tetracyclines (Doxycycline, Minocycline)',
  'Vancomycin',
  'ACE Inhibitors (Lisinopril, Enalapril)',
  'Anticonvulsants (Carbamazepine, Phenytoin)',
  'Insulin',
  'Tetanus Toxoid Vaccine',
  'Muscle Relaxants (Succinylcholine)',
  'Chemotherapy Agents',
  'Statins (Atorvastatin)',
  'Peanuts',
  'Tree Nuts (Walnuts, Almonds, Cashews, Pistachios)',
  'Shellfish (Shrimp, Crab, Lobster, Prawns)',
  'Finfish (Salmon, Tuna, Cod, Tilapia)',
  'Cow\'s Milk / Dairy / Lactose',
  'Eggs (Egg Whites & Yolks)',
  'Wheat / Gluten (Celiac / Wheat Allergy)',
  'Soy & Soybeans',
  'Sesame & Sesame Oil',
  'Mustard & Mustard Seed',
  'Celery & Celeriac',
  'Sulfites (Wine / Food Preservatives)',
  'Corn & Corn Byproducts',
  'Strawberries & Berries',
  'Citrus Fruits (Oranges, Lemons, Grapefruits)',
  'Kiwifruit',
  'Bananas',
  'Avocados',
  'Tomatoes & Nightshades',
  'Garlic & Onions',
  'Monosodium Glutamate (MSG)',
  'Tartrazine (Yellow Dye #5)',
  'Red Meat / Alpha-Gal (Mammalian Meat)',
  'Latex & Natural Rubber',
  'Honey Bee Stings',
  'Wasp & Yellow Jacket Stings',
  'Fire Ant Bites / Stings',
  'Hornet Stings',
  'Cat Dander & Saliva',
  'Dog Dander & Saliva',
  'Horse Dander',
  'Dust Mites & Household Dust',
  'Mold Spores (Aspergillus, Cladosporium)',
  'Grass Pollen (Bermuda, Rye, Timothy)',
  'Tree Pollen (Birch, Oak, Cedar, Pine)',
  'Weed Pollen (Ragweed, Mugwort)',
  'Cockroach Allergens',
  'Nickel & Metal Alloys',
  'Poison Ivy / Poison Oak (Urushiol)',
  'Synthetic Fragrances & Perfumes',
  'Sunlight / Solar Urticaria',
  'Cold Temperature / Cold Urticaria'
];

/**
 * Fetch master allergy list
 */
export async function fetchAllergiesCatalogFromFirestore(): Promise<string[]> {
  const path = "allergies_catalog";
  try {
    const colRef = collection(db, path);
    const q = query(colRef, orderBy("name", "asc"));
    const snap = await getDocs(q);
    
    const items: string[] = [];
    if (!snap.empty) {
      snap.forEach(docSnap => {
        const data = docSnap.data();
        if (data.name && !items.includes(data.name)) items.push(data.name);
      });
    }

    for (const name of DEFAULT_SYSTEM_ALLERGENS) {
      if (!items.includes(name)) {
        items.push(name);
      }
    }

    return items.sort((a, b) => a.localeCompare(b));
  } catch (err) {
    console.warn("[Firestore] Failed to fetch allergies catalog, using defaults:", err);
    return DEFAULT_SYSTEM_ALLERGENS.slice().sort((a, b) => a.localeCompare(b));
  }
}

/**
 * Add a new allergy to the Firebase 'allergies_catalog' collection
 */
export async function addAllergyToCatalogInFirestore(name: string, category: string = 'general'): Promise<boolean> {
  const path = "allergies_catalog";
  try {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const colRef = collection(db, path);
    await addDoc(colRef, cleanFirestoreData({
      name: trimmed,
      category,
      createdAt: serverTimestamp()
    }));
    return true;
  } catch (err) {
    console.warn("[Firestore] Failed to add allergy to catalog:", err);
    handleFirestoreError(err, OperationType.CREATE, path);
    return false;
  }
}

/**
 * Listen in real time to the Firebase allergies collection
 */
export function subscribeToAllergiesCatalog(callback: (allergies: string[]) => void): () => void {
  const path = "allergies_catalog";
  try {
    const colRef = collection(db, path);
    const q = query(colRef, orderBy("name", "asc"));
    return onSnapshot(q, (snap) => {
      const items: string[] = [];
      if (!snap.empty) {
        snap.forEach(docSnap => {
          const data = docSnap.data();
          if (data.name && !items.includes(data.name)) items.push(data.name);
        });
      }
      for (const def of DEFAULT_SYSTEM_ALLERGENS) {
        if (!items.includes(def)) {
          items.push(def);
        }
      }
      callback(items.sort((a, b) => a.localeCompare(b)));
    }, (err) => {
      console.warn("[Firestore] Allergies subscription notice:", err);
      handleFirestoreError(err, OperationType.GET, path);
    });
  } catch {
    callback(DEFAULT_SYSTEM_ALLERGENS.slice().sort((a, b) => a.localeCompare(b)));
    return () => {};
  }
}

export interface FirestoreResponder {
  id: string;
  socketId?: string;
  callSign: string;
  apparatus: 'ambulance' | 'police' | 'fire';
  status: 'waiting' | 'en_route' | 'on_scene' | 'transporting' | 'offline' | 'incoming';
  coords: [number, number];
  accuracy?: number;
  phone?: string;
  updatedAt?: any;
  lastSeen?: number;
}

/**
 * Sync responder presence and location directly to Firestore for global cross-device synchronization
 */
export async function syncResponderPresenceToFirestore(
  responder: Partial<FirestoreResponder> & { id: string; callSign: string; apparatus: string }
): Promise<boolean> {
  const path = `responders/${responder.id}`;
  try {
    const ref = doc(db, "responders", responder.id);
    const sanitized = cleanFirestoreData({
      id: responder.id,
      callSign: responder.callSign,
      apparatus: responder.apparatus,
      status: responder.status || 'waiting',
      coords: Array.isArray(responder.coords) && responder.coords.length === 2 && !isNaN(responder.coords[0]) && !isNaN(responder.coords[1])
        ? [responder.coords[0], responder.coords[1]]
        : [14.5995, 120.9842],
      accuracy: typeof responder.accuracy === 'number' ? responder.accuracy : 10,
      phone: responder.phone || '',
      updatedAt: serverTimestamp(),
      lastSeen: Date.now()
    });
    await setDoc(ref, sanitized, { merge: true });
    return true;
  } catch (err: any) {
    console.warn("[Firestore] Failed to sync responder presence to Firestore:", err?.message || err);
    return false;
  }
}

/**
 * Real-time subscription to active online responders across all devices
 */
export function subscribeToOnlineResponders(
  callback: (responders: FirestoreResponder[]) => void
): () => void {
  const path = "responders";
  try {
    const colRef = collection(db, path);
    return onSnapshot(colRef, (snapshot) => {
      const now = Date.now();
      const list: FirestoreResponder[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const lastSeenTime = typeof data.lastSeen === 'number'
          ? data.lastSeen
          : (data.updatedAt?.toMillis ? data.updatedAt.toMillis() : (data.lastSeen?.toMillis ? data.lastSeen.toMillis() : now));
        // Keep active responders online unless explicitly offline or inactive for over 12 hours
        const isRecent = (now - lastSeenTime) <= 43200000;
        if (data.status !== 'offline' && isRecent) {
          list.push({
            id: docSnap.id,
            callSign: data.callSign || 'Unit',
            apparatus: data.apparatus || 'ambulance',
            status: data.status || 'waiting',
            coords: Array.isArray(data.coords) && data.coords.length === 2 && !isNaN(data.coords[0]) && !isNaN(data.coords[1])
              ? [data.coords[0], data.coords[1]]
              : [14.6795, 120.5292],
            accuracy: typeof data.accuracy === 'number' ? data.accuracy : 10,
            phone: data.phone || '',
            lastSeen: lastSeenTime
          });
        }
      });
      callback(list);
    }, (error) => {
      console.warn("[Firestore] Responders subscription error:", error.message);
      handleFirestoreError(error, OperationType.GET, path);
    });
  } catch (err) {
    console.warn("[Firestore] Error initiating responders subscription:", err);
    return () => {};
  }
}

/**
 * Real-time subscription to a specific incident document in Firestore
 */
export function subscribeToIncidentStatus(
  incidentId: string,
  callback: (incident: FirestoreIncident | null) => void
): () => void {
  const path = `incidents/${incidentId}`;
  try {
    const ref = doc(db, "incidents", incidentId);
    return onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        callback({
          id: snap.id,
          code: data.code || '10-79',
          type: data.type || 'Emergency',
          priority: data.priority || 'critical',
          location: data.location || 'Location',
          reportedTime: data.reportedTime || '',
          patientName: data.patientName || '',
          recommendedUnit: data.recommendedUnit,
          service: data.service,
          targetResponderId: data.targetResponderId,
          acceptedUnit: data.acceptedUnit,
          declinedBy: Array.isArray(data.declinedBy) ? data.declinedBy : [],
          distanceKm: data.distanceKm || 0,
          etaMins: data.etaMins || 0,
          routeAlgorithm: data.routeAlgorithm || '',
          status: data.status || 'dispatched',
          coords: data.coords || [0, 0],
          details: data.details || '',
          createdAt: data.createdAt
        });
      } else {
        callback(null);
      }
    }, (err) => {
      console.warn("[Firestore] Incident status subscription error:", err);
    });
  } catch {
    return () => {};
  }
}

export interface DirectChat {
  id: string;
  citizenId: string;
  citizenName: string;
  responderId: string;
  responderName: string;
  responderApparatus?: string;
  lastMessage: string;
  lastMessageSender: string;
  lastMessageTime: string;
  updatedAt?: any;
}

export interface DirectChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  senderRole: 'citizen' | 'responder' | 'dispatch';
  text: string;
  timestamp: string;
  createdAt?: any;
}

export function getDirectChatId(citizenId: string, responderId: string): string {
  const safeCit = (citizenId || 'citizen').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeResp = (responderId || 'responder').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `chat_${safeCit}_${safeResp}`;
}

export async function sendDirectChatMessage(
  chatId: string,
  params: {
    senderId: string;
    senderName: string;
    senderRole: 'citizen' | 'responder' | 'dispatch';
    text: string;
    citizenId: string;
    citizenName: string;
    responderId: string;
    responderName: string;
    responderApparatus?: string;
  }
): Promise<DirectChatMessage | null> {
  const msgPath = `direct_chats/${chatId}/messages`;
  try {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    
    // 1. Update or create the DirectChat header document
    const chatDocRef = doc(db, "direct_chats", chatId);
    const chatDocPayload = cleanFirestoreData({
      id: chatId,
      citizenId: params.citizenId,
      citizenName: params.citizenName || 'Citizen',
      responderId: params.responderId,
      responderName: params.responderName || 'Responder Unit',
      responderApparatus: params.responderApparatus || 'ambulance',
      lastMessage: params.text,
      lastMessageSender: params.senderName,
      lastMessageTime: timeStr,
      updatedAt: serverTimestamp()
    });
    await setDoc(chatDocRef, chatDocPayload, { merge: true });

    // 2. Add message to the subcollection
    const msgDocRef = doc(db, "direct_chats", chatId, "messages", msgId);
    const msgPayload = cleanFirestoreData({
      id: msgId,
      chatId,
      senderId: params.senderId,
      senderName: params.senderName,
      senderRole: params.senderRole,
      text: params.text,
      timestamp: timeStr,
      createdAt: serverTimestamp()
    });
    await setDoc(msgDocRef, msgPayload);

    // Forward through local socket bridge for zero-latency multi-device push
    try {
      const baseUrl = typeof window !== 'undefined' ? (window.location.origin + '/api') : 'http://localhost:3000/api';
      fetch(`${baseUrl}/direct-chats/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, message: msgPayload, chat: chatDocPayload }),
        signal: AbortSignal.timeout(2000)
      }).catch(() => {});
    } catch {}

    return {
      id: msgId,
      chatId,
      senderId: params.senderId,
      senderName: params.senderName,
      senderRole: params.senderRole,
      text: params.text,
      timestamp: timeStr
    };
  } catch (err) {
    console.warn("[Firestore] Send direct chat message notice:", err);
    handleFirestoreError(err, OperationType.CREATE, msgPath);
    return null;
  }
}

export function subscribeToDirectChatMessages(
  chatId: string,
  callback: (messages: DirectChatMessage[]) => void
): () => void {
  try {
    const colRef = collection(db, "direct_chats", chatId, "messages");
    return onSnapshot(colRef, (snapshot) => {
      const list: DirectChatMessage[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        list.push({
          id: d.id,
          chatId: data.chatId || chatId,
          senderId: data.senderId || '',
          senderName: data.senderName || '',
          senderRole: data.senderRole || 'citizen',
          text: data.text || '',
          timestamp: data.timestamp || '',
          createdAt: data.createdAt
        });
      });
      list.sort((a, b) => {
        const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (parseInt(a.id.split('_')[1] || '0', 10));
        const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (parseInt(b.id.split('_')[1] || '0', 10));
        return tA - tB;
      });
      callback(list);
    }, (err) => {
      console.warn("[Firestore] Messages subscription notice:", err);
    });
  } catch {
    return () => {};
  }
}

export function subscribeToDirectChatsForResponder(
  responderIdentifier: string | { id?: string; uid?: string; callSign?: string; apparatus?: string },
  callback: (chats: DirectChat[]) => void
): () => void {
  const path = "direct_chats";
  try {
    const colRef = collection(db, path);
    return onSnapshot(colRef, (snapshot) => {
      const list: DirectChat[] = [];
      const idStr = typeof responderIdentifier === 'string' ? responderIdentifier : (responderIdentifier?.id || responderIdentifier?.uid || '');
      const callSignStr = typeof responderIdentifier === 'object' ? responderIdentifier?.callSign?.toLowerCase() : '';
      const apparatusStr = typeof responderIdentifier === 'object' ? responderIdentifier?.apparatus?.toLowerCase() : '';

      snapshot.forEach((d) => {
        const data = d.data();
        const matchesId = !idStr || data.responderId === idStr || (data.id && data.id.includes(idStr)) || data.responderId === 'all';
        const matchesCallSign = Boolean(callSignStr && data.responderName && data.responderName.toLowerCase() === callSignStr);
        const matchesApparatus = Boolean(apparatusStr && data.responderApparatus && data.responderApparatus.toLowerCase() === apparatusStr);

        if (matchesId || matchesCallSign || matchesApparatus || !responderIdentifier) {
          list.push({
            id: d.id,
            citizenId: data.citizenId || '',
            citizenName: data.citizenName || 'Citizen',
            responderId: data.responderId || idStr,
            responderName: data.responderName || 'Responder Unit',
            responderApparatus: data.responderApparatus,
            lastMessage: data.lastMessage || '',
            lastMessageSender: data.lastMessageSender || '',
            lastMessageTime: data.lastMessageTime || '',
            updatedAt: data.updatedAt
          });
        }
      });
      list.sort((a, b) => {
        const tA = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
        const tB = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
        return tB - tA;
      });
      callback(list);
    }, (err) => {
      console.warn("[Firestore] Direct chats subscription notice:", err);
    });
  } catch {
    return () => {};
  }
}

export {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  signInAnonymously
};
export type { User };


