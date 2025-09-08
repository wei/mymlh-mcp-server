export interface MyMLHUserProfile {
  country_of_residence?: string;
  race_or_ethnicity?: string;
  gender?: string;
  age?: number;
}

export interface MyMLHEducationEntry {
  id: string;
  current: boolean;
  school_name: string;
  school_type: string | null;
  start_date: number | null;
  end_date: number | null;
  major?: string | null;
}

export interface MyMLHEmploymentEntry {
  id: string;
  current: boolean;
  employer_name: string;
  company?: string;
  title?: string | null;
  type?: string | null;
  start_date: number | null;
  end_date: number | null;
}

export interface MyMLHAddress {
  id: string;
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postal_code?: string | null;
  country: string;
}

export interface MyMLHUser {
  id: string;
  created_at?: number;
  updated_at?: number;
  first_name: string;
  last_name: string;
  email: string;
  phone_number?: string;
  profile?: MyMLHUserProfile;
  address?: MyMLHAddress;
  professional_experience?: MyMLHEmploymentEntry[];
  education?: MyMLHEducationEntry[];
  // future optional fields: event_preferences, social_profiles, etc.
}

export interface MyMLHTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export type Props = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresIn?: number;
  // Unix time (seconds) when the current access token was issued
  accessTokenIssuedAt?: number;
};

export type ToolContext = {
  env: Env;
  getProps: () => Props;
  refreshUpstreamToken: () => Promise<MyMLHTokenResponse | null>;
  fetchMyMLHWithAutoRefresh: (url: string, init?: RequestInit) => Promise<Response>;
};
