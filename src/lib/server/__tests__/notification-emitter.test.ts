import type { DbNotification } from "@/lib/server/db-repository";
import {
  emitNotification,
  onNotification,
  emitActivityStatus,
  onActivityStatus,
  getListenerCounts,
  stopListenerMonitoring,
} from "@/lib/server/notification-emitter";
import type { ActivityStatusPayload } from "@/lib/server/notification-emitter";

// ─── Global teardown — stop the monitoring interval started on module load ────
afterAll(() => {
  stopListenerMonitoring();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNotification(overrides?: Partial<DbNotification>): DbNotification {
  return {
    id: "notif-1",
    type: "session_completed",
    message: "Test session finished",
    session_id: "sess-1",
    instance_id: "inst-1",
    pipeline_id: null,
    read: 0,
    created_at: "2025-01-01 00:00:00",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("notification emitter", () => {
  it("SubscriberReceivesEmittedNotification", () => {
    const received: DbNotification[] = [];
    const unsubscribe = onNotification((n) => received.push(n));

    const notification = makeNotification();
    emitNotification(notification);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(notification);
    unsubscribe();
  });

  it("MultipleSubscribersAllReceiveNotification", () => {
    const received1: DbNotification[] = [];
    const received2: DbNotification[] = [];
    const unsub1 = onNotification((n) => received1.push(n));
    const unsub2 = onNotification((n) => received2.push(n));

    emitNotification(makeNotification());

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
    unsub1();
    unsub2();
  });

  it("UnsubscribeStopsDelivery", () => {
    const received: DbNotification[] = [];
    const unsubscribe = onNotification((n) => received.push(n));

    emitNotification(makeNotification({ id: "first" }));
    unsubscribe();
    emitNotification(makeNotification({ id: "second" }));

    expect(received).toHaveLength(1);
    expect(received[0].id).toBe("first");
  });

  it("NoSubscribersDoesNotThrow", () => {
    expect(() => emitNotification(makeNotification())).not.toThrow();
  });

  it("NotificationDataIsPassedThrough", () => {
    const received: DbNotification[] = [];
    const unsubscribe = onNotification((n) => received.push(n));

    const notification = makeNotification({
      id: "custom-id",
      type: "session_error",
      message: "Something broke",
      session_id: "sess-99",
      instance_id: "inst-77",
      read: 0,
    });
    emitNotification(notification);

    expect(received[0].id).toBe("custom-id");
    expect(received[0].type).toBe("session_error");
    expect(received[0].message).toBe("Something broke");
    expect(received[0].session_id).toBe("sess-99");
    expect(received[0].instance_id).toBe("inst-77");
    unsubscribe();
  });

  it("MultipleEmissionsDeliverInOrder", () => {
    const received: DbNotification[] = [];
    const unsubscribe = onNotification((n) => received.push(n));

    emitNotification(makeNotification({ id: "a" }));
    emitNotification(makeNotification({ id: "b" }));
    emitNotification(makeNotification({ id: "c" }));

    expect(received).toHaveLength(3);
    expect(received.map((n) => n.id)).toEqual(["a", "b", "c"]);
    unsubscribe();
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeActivityStatus(overrides?: Partial<ActivityStatusPayload>): ActivityStatusPayload {
  return {
    sessionId: "sess-1",
    instanceId: "inst-1",
    activityStatus: "idle",
    ...overrides,
  };
}

// ─── Activity Status Tests ────────────────────────────────────────────────────

describe("activity status emitter", () => {
  it("SubscriberReceivesEmittedActivityStatus", () => {
    const received: ActivityStatusPayload[] = [];
    const unsubscribe = onActivityStatus((p) => received.push(p));

    const payload = makeActivityStatus();
    emitActivityStatus(payload);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(payload);
    unsubscribe();
  });

  it("MultipleSubscribersAllReceiveActivityStatus", () => {
    const received1: ActivityStatusPayload[] = [];
    const received2: ActivityStatusPayload[] = [];
    const unsub1 = onActivityStatus((p) => received1.push(p));
    const unsub2 = onActivityStatus((p) => received2.push(p));

    emitActivityStatus(makeActivityStatus());

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
    unsub1();
    unsub2();
  });

  it("UnsubscribeStopsActivityStatusDelivery", () => {
    const received: ActivityStatusPayload[] = [];
    const unsubscribe = onActivityStatus((p) => received.push(p));

    emitActivityStatus(makeActivityStatus({ activityStatus: "busy" }));
    unsubscribe();
    emitActivityStatus(makeActivityStatus({ activityStatus: "idle" }));

    expect(received).toHaveLength(1);
    expect(received[0].activityStatus).toBe("busy");
  });

  it("NoSubscribersDoesNotThrow", () => {
    expect(() => emitActivityStatus(makeActivityStatus())).not.toThrow();
  });

  it("ActivityStatusPayloadIsPassedThrough", () => {
    const received: ActivityStatusPayload[] = [];
    const unsubscribe = onActivityStatus((p) => received.push(p));

    const payload = makeActivityStatus({
      sessionId: "sess-99",
      instanceId: "inst-77",
      activityStatus: "waiting_input",
    });
    emitActivityStatus(payload);

    expect(received[0].sessionId).toBe("sess-99");
    expect(received[0].instanceId).toBe("inst-77");
    expect(received[0].activityStatus).toBe("waiting_input");
    unsubscribe();
  });

  it("ActivityAndNotificationChannelsAreIndependent", () => {
    const notifReceived: DbNotification[] = [];
    const activityReceived: ActivityStatusPayload[] = [];

    const unsubNotif = onNotification((n) => notifReceived.push(n));
    const unsubActivity = onActivityStatus((p) => activityReceived.push(p));

    // Emit only activity status
    emitActivityStatus(makeActivityStatus({ activityStatus: "busy" }));

    expect(activityReceived).toHaveLength(1);
    expect(notifReceived).toHaveLength(0);

    // Emit only notification
    emitNotification(makeNotification({ id: "notif-x" }));

    expect(notifReceived).toHaveLength(1);
    expect(activityReceived).toHaveLength(1); // unchanged

    unsubNotif();
    unsubActivity();
  });
});

// ─── Listener monitoring tests ────────────────────────────────────────────────

describe("listener monitoring", () => {
  it("getListenerCounts returns correct counts", () => {
    const before = getListenerCounts();

    const unsubNotif = onNotification(() => {});
    const unsubActivity1 = onActivityStatus(() => {});
    const unsubActivity2 = onActivityStatus(() => {});

    const counts = getListenerCounts();
    expect(counts.notification).toBe(before.notification + 1);
    expect(counts.activity_status).toBe(before.activity_status + 2);

    unsubNotif();
    unsubActivity1();
    unsubActivity2();

    const after = getListenerCounts();
    expect(after.notification).toBe(before.notification);
    expect(after.activity_status).toBe(before.activity_status);
  });
});
