import test from "node:test";
import assert from "node:assert/strict";
import { tickManager } from "../../packs/BP/scripts/core/tickManager.js";
import { activeJobs, resetMocks, scheduledIntervals, system } from "../mocks/minecraftServer.js";

test("TickManager Staggered Scheduling & Lifecycle", async (t) => {
    t.beforeEach(() => {
        resetMocks();
        tickManager.stop();
        // Clear any tasks registered in previous tests
        for (const taskId of tickManager.getRegisteredTaskIds()) {
            tickManager.unregister(taskId);
        }
    });

    await t.test("registers tasks and dispatches based on interval and offset", () => {
        let task1Runs = 0;
        let task2Runs = 0;

        // Task 1: every 20 ticks, offset 0 -> runs at tick 0, 20, 40...
        tickManager.register("task1", 20, () => {
            task1Runs++;
        }, 0);

        tickManager.register("task2", 20, () => {
            task2Runs++;
        }, 5);

        tickManager.step();
        assert.equal(task1Runs, 1);
        assert.equal(task2Runs, 0);

        for (let i = 1; i <= 4; i++) {
            tickManager.step();
        }
        assert.equal(task1Runs, 1);
        assert.equal(task2Runs, 0);

        tickManager.step();
        assert.equal(task1Runs, 1);
        assert.equal(task2Runs, 1);

        for (let i = 6; i <= 20; i++) {
            tickManager.step();
        }
        assert.equal(task1Runs, 2);
        assert.equal(task2Runs, 1);
    });

    await t.test("dispatches generator tasks to system.runJob", () => {
        function* heavyJob() {
            yield;
        }

        tickManager.register("heavyTask", 10, () => heavyJob(), 0);
        tickManager.step(); // Tick 0 -> task executes, returns generator, queued into runJob

        assert.equal(activeJobs.length, 1, "a returned generator is queued as a job, not drained inline");
    });

    await t.test("isolates errors so a crashing task does not halt other tasks in the same tick", () => {
        let task2Ran = false;

        tickManager.register("brokenTask", 1, () => {
            throw new Error("Task crash simulation");
        }, 0);

        tickManager.register("healthyTask", 1, () => {
            task2Ran = true;
        }, 0);

        assert.doesNotThrow(() => {
            tickManager.step();
        });

        assert.equal(task2Ran, true);
    });

    await t.test("controls master loop through start and stop lifecycle", () => {
        tickManager.start();
        assert.equal(scheduledIntervals.length, 1);
        assert.equal(scheduledIntervals[0].interval, 1);

        // Starting again is idempotent
        tickManager.start();
        assert.equal(scheduledIntervals.length, 1);

        tickManager.stop();
        assert.equal(scheduledIntervals.length, 0);
    });

    await t.test("unregisters tasks correctly", () => {
        let runs = 0;
        tickManager.register("tempTask", 1, () => {
            runs++;
        });

        tickManager.step();
        assert.equal(runs, 1);

        tickManager.unregister("tempTask");
        assert.equal(tickManager.isRegistered("tempTask"), false);

        tickManager.step();
        assert.equal(runs, 1);
    });

    await t.test("suppresses concurrent overlapping generator executions while in flight", () => {
        let runs = 0;

        function* longJob() {
            yield;
            yield;
        }

        tickManager.register("overlapTask", 2, () => {
            runs++;
            return longJob();
        }, 0);

        tickManager.step();
        assert.equal(runs, 1, "the task runs on its first scheduled tick");
        assert.equal(activeJobs.length, 1, "and its generator is queued rather than drained inline");

        // Its interval comes due again while that generator is still in flight.
        tickManager.step();
        tickManager.step();
        assert.equal(runs, 1, "task must not be re-invoked while previous generator is in flight");

        system.advanceTicks(3);
        assert.equal(activeJobs.length, 0, "the finished generator is untracked");

        tickManager.step();
        tickManager.step();
        assert.equal(runs, 2, "task is invoked on next scheduled tick after generator completes");
    });

    await t.test("cancels in-flight generator jobs when a task is unregistered or the loop stops", () => {
        function* infiniteJob() {
            while (true) {
                yield;
            }
        }

        tickManager.register("activeGenTask", 1, () => infiniteJob(), 0);
        tickManager.register("siblingGenTask", 1, () => infiniteJob(), 0);
        tickManager.step();
        assert.equal(activeJobs.length, 2, "each task's generator is queued");

        tickManager.unregister("activeGenTask");
        assert.equal(activeJobs.length, 1, "unregistering a task clears its own in-flight generator job");

        tickManager.stop();
        assert.equal(activeJobs.length, 0, "and stopping the loop clears the rest");
    });

    await t.test("recovers and clears in-flight state when a generator step throws", () => {
        let invocations = 0;

        function* faultyJob() {
            yield;
            throw new Error("Simulated generator step failure");
        }

        tickManager.register("faultyTask", 2, () => {
            invocations++;
            return faultyJob();
        }, 0);

        tickManager.step();
        assert.equal(invocations, 1);
        assert.equal(activeJobs.length, 1);

        system.advanceTicks(2);
        assert.equal(activeJobs.length, 0, "a throwing generator step untracks the job");

        tickManager.step();
        tickManager.step();
        assert.equal(invocations, 2, "task can run again after previous generator error was handled");
    });
});

