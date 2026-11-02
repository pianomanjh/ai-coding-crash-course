import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import {
  canUserRateCourse,
  rateCourse,
  getUserRatingForCourse,
  getCourseRatingSummary,
  getRatingSummariesForCourses,
} from "./ratingService";
import { enrollUser, markEnrollmentComplete } from "./enrollmentService";
import { markLessonComplete, markLessonInProgress } from "./progressService";

function createLesson() {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module", position: 1 })
    .returning()
    .get();
  return testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson", position: 1 })
    .returning()
    .get();
}

function createEligibleStudent(email: string) {
  const student = testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Student })
    .returning()
    .get();
  enrollUser(student.id, base.course.id, false, false);
  markEnrollmentComplete(student.id, base.course.id);
  return student;
}

describe("ratingService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("canUserRateCourse", () => {
    it("rejects a user who is not enrolled, even with a completed lesson", () => {
      markLessonComplete(base.user.id, createLesson().id);

      expect(canUserRateCourse(base.user.id, base.course.id)).toBe(false);
    });

    it("rejects an enrolled student with no completed lessons", () => {
      enrollUser(base.user.id, base.course.id, false, false);
      markLessonInProgress(base.user.id, createLesson().id);

      expect(canUserRateCourse(base.user.id, base.course.id)).toBe(false);
    });

    it("allows an enrolled student who completed a lesson", () => {
      enrollUser(base.user.id, base.course.id, false, false);
      markLessonComplete(base.user.id, createLesson().id);

      expect(canUserRateCourse(base.user.id, base.course.id)).toBe(true);
    });

    it("allows a student who completed the course", () => {
      enrollUser(base.user.id, base.course.id, false, false);
      markEnrollmentComplete(base.user.id, base.course.id);

      expect(canUserRateCourse(base.user.id, base.course.id)).toBe(true);
    });

    it("rejects the course's instructor even when otherwise eligible", () => {
      enrollUser(base.instructor.id, base.course.id, false, false);
      markLessonComplete(base.instructor.id, createLesson().id);
      markEnrollmentComplete(base.instructor.id, base.course.id);

      expect(canUserRateCourse(base.instructor.id, base.course.id)).toBe(false);
    });

    it("allows an instructor of a different course", () => {
      const otherCourse = testDb
        .insert(schema.courses)
        .values({
          title: "Other",
          slug: "other",
          description: "Other course",
          instructorId: base.user.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();
      enrollUser(base.instructor.id, otherCourse.id, false, false);
      markEnrollmentComplete(base.instructor.id, otherCourse.id);

      expect(canUserRateCourse(base.instructor.id, otherCourse.id)).toBe(true);
    });

    it("returns false for a non-existent course", () => {
      expect(canUserRateCourse(base.user.id, 9999)).toBe(false);
    });
  });

  describe("rateCourse", () => {
    it("saves a rating", () => {
      const student = createEligibleStudent("a@example.com");

      rateCourse(student.id, base.course.id, 4);

      expect(getUserRatingForCourse(student.id, base.course.id)).toBe(4);
    });

    it("replaces the user's earlier rating instead of adding another", () => {
      const student = createEligibleStudent("a@example.com");

      rateCourse(student.id, base.course.id, 2);
      rateCourse(student.id, base.course.id, 5);

      expect(getCourseRatingSummary(base.course.id)).toEqual({
        average: 5,
        count: 1,
      });
    });

    it.each([0, 6, 2.5, NaN])("rejects a rating of %s", (rating) => {
      const student = createEligibleStudent("a@example.com");

      expect(() => rateCourse(student.id, base.course.id, rating)).toThrowError(
        "Rating must be a whole number from 1 to 5"
      );
    });

    it("rejects a user who isn't allowed to rate", () => {
      expect(() =>
        rateCourse(base.instructor.id, base.course.id, 5)
      ).toThrowError("User is not allowed to rate this course");
      expect(getCourseRatingSummary(base.course.id).count).toBe(0);
    });
  });

  describe("getUserRatingForCourse", () => {
    it("returns null when the user hasn't rated", () => {
      expect(getUserRatingForCourse(base.user.id, base.course.id)).toBeNull();
    });
  });

  describe("rating summaries", () => {
    it("returns no average for an unrated course", () => {
      expect(getCourseRatingSummary(base.course.id)).toEqual({
        average: null,
        count: 0,
      });
    });

    it("averages ratings across students", () => {
      rateCourse(createEligibleStudent("a@example.com").id, base.course.id, 5);
      rateCourse(createEligibleStudent("b@example.com").id, base.course.id, 4);

      expect(getCourseRatingSummary(base.course.id)).toEqual({
        average: 4.5,
        count: 2,
      });
    });

    it("omits unrated courses from the batch lookup", () => {
      const summaries = getRatingSummariesForCourses([base.course.id]);

      expect(summaries.size).toBe(0);
    });

    it("handles an empty course list", () => {
      expect(getRatingSummariesForCourses([]).size).toBe(0);
    });
  });
});
