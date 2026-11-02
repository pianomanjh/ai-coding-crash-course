import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import { courseRatings, courses } from "~/db/schema";
import { findEnrollment } from "~/services/enrollmentService";
import { getCompletedLessonCount } from "~/services/progressService";

// ─── Rating Service ───
// Handles star ratings for courses: who may rate, saving a rating, and averages.
// Uses positional parameters (project convention).

export function canUserRateCourse(userId: number, courseId: number) {
  const course = db
    .select({ instructorId: courses.instructorId })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  if (!course || course.instructorId === userId) return false;

  const enrollment = findEnrollment(userId, courseId);
  if (!enrollment) return false;

  return (
    enrollment.completedAt !== null ||
    getCompletedLessonCount(userId, courseId) > 0
  );
}

export function rateCourse(userId: number, courseId: number, rating: number) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("Rating must be a whole number from 1 to 5");
  }

  if (!canUserRateCourse(userId, courseId)) {
    throw new Error("User is not allowed to rate this course");
  }

  return db
    .insert(courseRatings)
    .values({ userId, courseId, rating })
    .onConflictDoUpdate({
      target: [courseRatings.userId, courseRatings.courseId],
      set: { rating, updatedAt: new Date().toISOString() },
    })
    .returning()
    .get();
}

export function getUserRatingForCourse(userId: number, courseId: number) {
  const result = db
    .select({ rating: courseRatings.rating })
    .from(courseRatings)
    .where(
      and(eq(courseRatings.userId, userId), eq(courseRatings.courseId, courseId))
    )
    .get();

  return result?.rating ?? null;
}

export function getRatingSummariesForCourses(courseIds: number[]) {
  const rows = db
    .select({
      courseId: courseRatings.courseId,
      average: sql<number>`avg(${courseRatings.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(courseRatings)
    .where(inArray(courseRatings.courseId, courseIds))
    .groupBy(courseRatings.courseId)
    .all();

  return new Map(
    rows.map((row) => [
      row.courseId,
      { average: row.average as number | null, count: row.count },
    ])
  );
}

export function getCourseRatingSummary(courseId: number) {
  return (
    getRatingSummariesForCourses([courseId]).get(courseId) ?? {
      average: null,
      count: 0,
    }
  );
}
