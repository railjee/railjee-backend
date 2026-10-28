export const APP_CONSTANTS = {
  // Application Info
  APP_NAME: 'Railji Business',
  APP_VERSION: '1.0.0',

  // API Configuration
  API_PREFIX: 'business/v1',
  DEFAULT_PAGE_SIZE: 10,
  MAX_PAGE_SIZE: 100,

  // Database
  DEFAULT_SORT_ORDER: 'desc',
  DEFAULT_SORT_FIELD: 'createdAt',

  // Exam Submission Status (User Attempt Progress)
  EXAM_STATUS: {
    IN_PROGRESS: 'in-progress',
    SUBMITTED: 'submitted',
    TIMEOUT: 'timeout',
  },

  // Exam Mode
  EXAM_MODE: {
    MOCK: 'mock',
    LIVE: 'live',
  },

  // Paper Related
  PAPER_STATUS: {
    DRAFT: 'draft',
    PUBLISHED: 'published',
    ARCHIVED: 'archived',
  },

  // Question Types
  QUESTION_TYPES: {
    MULTIPLE_CHOICE: 'multiple-choice',
    TRUE_FALSE: 'true-false',
    SHORT_ANSWER: 'short-answer',
    ESSAY: 'essay',
  },

  // Difficulty Levels
  DIFFICULTY_LEVELS: {
    EASY: 'easy',
    MEDIUM: 'medium',
    HARD: 'hard',
  },

  // Time Constants (in minutes)
  DEFAULT_EXAM_DURATION: 60,
  MIN_EXAM_DURATION: 15,
  MAX_EXAM_DURATION: 300,

  // Validation
  MIN_PASSWORD_LENGTH: 8,
  MAX_NAME_LENGTH: 100,
  MAX_DESCRIPTION_LENGTH: 500,

  // Cache TTL (in seconds)
  CACHE_TTL: {
    SHORT: 300, // 5 minutes
    MEDIUM: 1800, // 30 minutes
    LONG: 3600, // 1 hour
  },

  // Authentication Exclusions (routes that don't require JWT authentication)
  AUTH_EXCLUDED_ROUTES: [
    '/business/v1/health',
    '/business/v1/departments',
    '/business/v1/papers/top',
    '/business/v1/papers/:departmentId',
    '/business/v1/users',
    '/business/v1/payments/webhook/razorpay',
    '/business/v1/payments/plans',
  ],
} as const;

// Export individual constants for convenience
export const {
  API_PREFIX,
  EXAM_STATUS,
  EXAM_MODE,
  PAPER_STATUS,
  QUESTION_TYPES,
  AUTH_EXCLUDED_ROUTES,
} = APP_CONSTANTS;
