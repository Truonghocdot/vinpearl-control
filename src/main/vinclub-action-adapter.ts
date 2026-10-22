import type { AppiumClient, AppiumElementSelector, AppiumSession } from './appium-client';
import type { WorkflowStep } from './workflow-runner';

export type VinClubSelectorProfile = {
  date: { open: AppiumElementSelector; checkIn: AppiumElementSelector; checkOut: AppiumElementSelector; confirm: AppiumElementSelector };
  guests: { open: AppiumElementSelector; rooms: AppiumElementSelector; adults: AppiumElementSelector; children: AppiumElementSelector; infants: AppiumElementSelector; confirm: AppiumElementSelector };
};

// This profile is intentionally supplied only after a WDA accessibility-tree spike.
export class VinClubActionAdapter {
  constructor(private readonly client: AppiumClient, private readonly profile: VinClubSelectorProfile) {}

  async execute(session: AppiumSession, step: WorkflowStep, variables: Record<string, unknown>) {
    if (step.type === 'selectDate') {
      await this.client.click(session.id, this.profile.date.open);
      await this.client.input(session.id, this.profile.date.checkIn, value(step.checkIn, variables));
      await this.client.input(session.id, this.profile.date.checkOut, value(step.checkOut, variables));
      return this.client.click(session.id, this.profile.date.confirm);
    }
    if (step.type === 'selectGuests') {
      await this.client.click(session.id, this.profile.guests.open);
      await this.client.input(session.id, this.profile.guests.rooms, value(step.rooms, variables));
      await this.client.input(session.id, this.profile.guests.adults, value(step.adults, variables));
      await this.client.input(session.id, this.profile.guests.children, value(step.children, variables));
      await this.client.input(session.id, this.profile.guests.infants, value(step.infants, variables));
      return this.client.click(session.id, this.profile.guests.confirm);
    }
    throw new Error(`VinClub adapter không hỗ trợ ${step.type}.`);
  }
}

function value(input: unknown, variables: Record<string, unknown>) { return String(input ?? '').replace(/\{\{([\w.-]+)\}\}/g, (_match, key: string) => String(variables[key] ?? '')); }
