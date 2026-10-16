export type AsrQueueSnapshot = {
  readonly activeMeetingId?: string;
  readonly queuedMeetingIds: readonly string[];
};

export class SerialAsrQueue {
  private tail: Promise<void> = Promise.resolve();
  private activeMeetingId: string | undefined;
  private readonly queuedMeetingIds: string[] = [];

  snapshot(): AsrQueueSnapshot {
    return {
      ...(this.activeMeetingId
        ? { activeMeetingId: this.activeMeetingId }
        : {}),
      queuedMeetingIds: [...this.queuedMeetingIds],
    };
  }

  run<T>(meetingId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release = (): void => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queuedMeetingIds.push(meetingId);

    return previous.then(async () => {
      const index = this.queuedMeetingIds.indexOf(meetingId);
      if (index >= 0) this.queuedMeetingIds.splice(index, 1);
      this.activeMeetingId = meetingId;
      try {
        return await task();
      } finally {
        this.activeMeetingId = undefined;
        release();
      }
    });
  }
}

export const meetingAsrQueue = new SerialAsrQueue();
