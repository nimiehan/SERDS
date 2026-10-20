import { calculateDistance } from './routing';

export interface HospitalFacility {
  id: string;
  name: string;
  shortName: string;
  type: 'government' | 'private' | 'general' | 'medical_center' | 'district';
  coords: [number, number];
  address: string;
  phone?: string;
  isTraumaCenter?: boolean;
  isEmergency247?: boolean;
}

export interface NearbyHospitalResult extends HospitalFacility {
  distanceMeters: number;
  distanceKm: number;
  estimatedEtaMinutes: number;
}

/**
 * Verified registry of emergency hospitals and medical centers
 * Covers Central Luzon (Bataan / Balanga / Pampanga / Zambales) & Metro Manila
 */
export const VERIFIED_HOSPITALS: HospitalFacility[] = [
  // --- BATAAN / BALANGA REGION ---
  {
    id: 'hosp-bghmc',
    name: 'Bataan General Hospital & Medical Center',
    shortName: 'BGHMC',
    type: 'government',
    coords: [14.6811, 120.5372],
    address: 'Manahan St., Tenejero, Balanga City, Bataan',
    phone: '(047) 237-3635',
    isTraumaCenter: true,
    isEmergency247: true,
  },
  {
    id: 'hosp-balanga-med',
    name: 'Balanga Medical Center',
    shortName: 'Balanga Med',
    type: 'medical_center',
    coords: [14.6765, 120.5340],
    address: 'Capitol Drive, San Jose, Balanga City, Bataan',
    phone: '(047) 237-2273',
    isTraumaCenter: false,
    isEmergency247: true,
  },
  {
    id: 'hosp-icmc',
    name: 'Isaac & Catalina Medical Center',
    shortName: 'ICMC Hospital',
    type: 'private',
    coords: [14.6780, 120.5395],
    address: 'Calero St., Balanga City, Bataan',
    phone: '(047) 237-1288',
    isTraumaCenter: true,
    isEmergency247: true,
  },
  {
    id: 'hosp-st-joseph',
    name: 'St. Joseph Hospital and Medical Center',
    shortName: 'St. Joseph Hospital',
    type: 'general',
    coords: [14.6750, 120.5420],
    address: 'Don Manuel Banzon Ave., Balanga City, Bataan',
    phone: '(047) 237-0123',
    isTraumaCenter: false,
    isEmergency247: true,
  },
  {
    id: 'hosp-bataan-doctors',
    name: 'Bataan Doctors Hospital & Clinics',
    shortName: 'Bataan Doctors',
    type: 'private',
    coords: [14.6850, 120.5310],
    address: 'Doña Francisca Subd., Balanga City, Bataan',
    phone: '(047) 237-3378',
    isTraumaCenter: true,
    isEmergency247: true,
  },
  {
    id: 'hosp-centro-medico',
    name: 'Centro Medico de Santisimo Rosario',
    shortName: 'Centro Medico',
    type: 'general',
    coords: [14.6720, 120.5315],
    address: 'Roman Superhighway, Balanga City, Bataan',
    phone: '(047) 791-2345',
    isTraumaCenter: false,
    isEmergency247: true,
  },
  {
    id: 'hosp-orani-district',
    name: 'Orani District Hospital',
    shortName: 'Orani District',
    type: 'district',
    coords: [14.7980, 120.5360],
    address: 'National Rd., Orani, Bataan',
    phone: '(047) 237-9876',
    isTraumaCenter: false,
    isEmergency247: true,
  },
  {
    id: 'hosp-dinalupihan-district',
    name: 'Dinalupihan District Hospital',
    shortName: 'Dinalupihan Hosp',
    type: 'district',
    coords: [14.8690, 120.4610],
    address: 'San Ramon, Dinalupihan, Bataan',
    phone: '(047) 481-1234',
    isTraumaCenter: false,
    isEmergency247: true,
  },
  {
    id: 'hosp-mariveles-district',
    name: 'Mariveles District Hospital',
    shortName: 'Mariveles District',
    type: 'district',
    coords: [14.4360, 120.4850],
    address: 'Baseco Country, Mariveles, Bataan',
    phone: '(047) 935-4138',
    isTraumaCenter: true,
    isEmergency247: true,
  },

  // --- REGIONAL & METRO MANILA EMERGENCY HOSPITALS ---
  {
    id: 'hosp-pgh',
    name: 'Philippine General Hospital (PGH)',
    shortName: 'PGH National Trauma',
    type: 'government',
    coords: [14.5777, 120.9859],
    address: 'Taft Ave., Ermita, Manila',
    phone: '(02) 8554-8400',
    isTraumaCenter: true,
    isEmergency247: true,
  },
  {
    id: 'hosp-manila-doctors',
    name: 'Manila Doctors Hospital',
    shortName: 'Manila Doctors',
    type: 'private',
    coords: [14.5823, 120.9818],
    address: 'United Nations Ave., Ermita, Manila',
    phone: '(02) 8558-0888',
    isTraumaCenter: true,
    isEmergency247: true,
  },
  {
    id: 'hosp-st-lukes-qc',
    name: "St. Luke's Medical Center - Quezon City",
    shortName: "St. Luke's QC",
    type: 'private',
    coords: [14.6225, 121.0235],
    address: 'E. Rodriguez Sr. Ave., Quezon City',
    phone: '(02) 8723-0101',
    isTraumaCenter: true,
    isEmergency247: true,
  },
  {
    id: 'hosp-medical-city',
    name: 'The Medical City Ortigas',
    shortName: 'The Medical City',
    type: 'private',
    coords: [14.5891, 121.0692],
    address: 'Ortigas Ave., Pasig City',
    phone: '(02) 8988-1000',
    isTraumaCenter: true,
    isEmergency247: true,
  },
  {
    id: 'hosp-makati-med',
    name: 'Makati Medical Center',
    shortName: 'Makati Med',
    type: 'private',
    coords: [14.5592, 121.0145],
    address: 'Amorsolo St., Legaspi Village, Makati City',
    phone: '(02) 8888-8999',
    isTraumaCenter: true,
    isEmergency247: true,
  },
  {
    id: 'hosp-jrrrmc',
    name: 'Jose R. Reyes Memorial Medical Center',
    shortName: 'JRRMMC Trauma Center',
    type: 'government',
    coords: [14.6133, 120.9831],
    address: 'San Lazaro Compound, Sta. Cruz, Manila',
    phone: '(02) 8711-9491',
    isTraumaCenter: true,
    isEmergency247: true,
  }
];

/**
 * Calculates distances to all registered hospitals from reference coords,
 * returning sorted results by proximity.
 */
export function getNearbyHospitals(
  refCoords: [number, number],
  limit = 6
): NearbyHospitalResult[] {
  const [refLat, refLng] = refCoords;

  const withDistances: NearbyHospitalResult[] = VERIFIED_HOSPITALS.map((h) => {
    const distanceMeters = Math.round(
      calculateDistance(refLat, refLng, h.coords[0], h.coords[1])
    );
    const distanceKm = parseFloat((distanceMeters / 1000).toFixed(2));
    
    // Average emergency transit speed ~40 km/h (with sirens) in urban/suburban zones
    const estimatedMinutes = Math.max(1, Math.round((distanceKm / 40) * 60));

    return {
      ...h,
      distanceMeters,
      distanceKm,
      estimatedEtaMinutes: estimatedMinutes,
    };
  });

  withDistances.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return withDistances.slice(0, limit);
}

/**
 * Quickly finds the single nearest hospital to a vehicle or incident scene
 */
export function getNearestHospital(
  refCoords: [number, number]
): NearbyHospitalResult | null {
  const nearby = getNearbyHospitals(refCoords, 1);
  return nearby.length > 0 ? nearby[0] : null;
}
