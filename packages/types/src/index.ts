export type Locale = 'en' | 'om';
export type ApplicationStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'NEEDS_CORRECTION' | 'APPROVED' | 'DECLINED';
export type PaymentStatus = 'NOT_REQUIRED' | 'PENDING' | 'RECEIPT_SUBMITTED' | 'VERIFIED' | 'REJECTED';
export interface ApiError { statusCode: number; message: string | string[]; error?: string; }
