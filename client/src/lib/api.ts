import type { BaseConfig, Configuration, SessionConfig, SessionDataResponse, SessionListItem } from '../types';

// In production, use relative URL; in dev, use localhost:3000
const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api');

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: response.statusText,
      }));
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  // Configurations
  async getConfigurations(): Promise<Configuration[]> {
    return this.request<Configuration[]>('/configurations');
  }

  async getConfiguration(configId: string): Promise<Configuration> {
    return this.request<Configuration>(`/configurations/${configId}`);
  }

  async createConfiguration(data: { configId: string; name: string; config: BaseConfig }): Promise<{ message: string; configId: string }> {
    return this.request('/configurations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateConfiguration(configId: string, data: { name: string; config: BaseConfig }): Promise<{ message: string }> {
    return this.request(`/configurations/${configId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteConfiguration(configId: string): Promise<{ message: string }> {
    return this.request(`/configurations/${configId}`, {
      method: 'DELETE',
    });
  }

  async getConfigurationSessions(configId: string): Promise<SessionListItem[]> {
    return this.request<SessionListItem[]>(`/configurations/${configId}/sessions`);
  }

  // Sessions
  async getSessions(): Promise<SessionListItem[]> {
    return this.request<SessionListItem[]>('/sessions');
  }

  async getSessionData(sessionId: string): Promise<SessionDataResponse> {
    return this.request<SessionDataResponse>(`/sessions/${sessionId}/data`);
  }

  async startSession(data: { sessionId: string; configId: string }): Promise<{ message: string; sessionId: string; config: BaseConfig }> {
    return this.request('/sessions/start', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async endSession(sessionId: string): Promise<{ message: string }> {
    return this.request(`/sessions/${sessionId}/end`, {
      method: 'POST',
    });
  }

  async deleteSession(sessionId: string): Promise<{ message: string }> {
    return this.request(`/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  }

  // Events
  async logEvent(data: {
    sessionId: string;
    event: 'start' | 'end' | 'click';
    value: unknown;
    timestamp?: string;
  }): Promise<{ message: string }> {
    return this.request('/events', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}

export const api = new ApiClient();
