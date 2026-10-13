import { describe, expect, it } from "vitest";
import {
  PresentationController,
  type PresentationSlide,
} from "../src/presentation.js";

describe("Presenter Mode & Speaker Notes Engine", () => {
  const sampleSlides: readonly PresentationSlide[] = [
    {
      id: "slide-1",
      title: "Introduction",
      startMicroseconds: 0n,
      durationMicroseconds: 5000000n,
      speakerNotes: "Welcome everyone.",
    },
    {
      id: "slide-2",
      title: "Key Metrics",
      startMicroseconds: 5000000n,
      durationMicroseconds: 8000000n,
      speakerNotes: "Highlight Q3 growth.",
    },
    {
      id: "slide-3",
      title: "Conclusion",
      startMicroseconds: 13000000n,
      durationMicroseconds: 4000000n,
      speakerNotes: "Call to action.",
    },
  ];

  it("navigates forward and backward through slides", () => {
    const controller = new PresentationController(sampleSlides);
    expect(controller.slideCount).toBe(3);
    expect(controller.currentSlideIndex).toBe(0);
    expect(controller.currentSlide?.title).toBe("Introduction");

    expect(controller.nextSlide()).toBe(true);
    expect(controller.currentSlideIndex).toBe(1);

    expect(controller.nextSlide()).toBe(true);
    expect(controller.currentSlideIndex).toBe(2);
    // Boundary check
    expect(controller.nextSlide()).toBe(false);

    expect(controller.prevSlide()).toBe(true);
    expect(controller.currentSlideIndex).toBe(1);
  });

  it("updates speaker notes dynamically", () => {
    const controller = new PresentationController(sampleSlides);
    const updated = controller.updateSpeakerNotes(
      "slide-2",
      "Mention new client acquisitions.",
    );
    expect(updated).toBe(true);
    expect(controller.allSlides[1]?.speakerNotes).toBe(
      "Mention new client acquisitions.",
    );
  });

  it("toggles and tracks laser pointer trails with expiration", () => {
    const controller = new PresentationController(sampleSlides);
    expect(controller.currentTool).toBe("normal");

    controller.toggleLaser();
    expect(controller.currentTool).toBe("laser");

    const t0 = 10000;
    controller.updatePointerPosition(100, 200, t0);
    controller.updatePointerPosition(150, 220, t0 + 500);

    let trail = controller.getLaserTrail(t0 + 600);
    expect(trail.length).toBe(2);

    // After 2.1 seconds, all older points expire
    trail = controller.getLaserTrail(t0 + 2100);
    expect(trail.length).toBe(0);
  });

  it("manages spotlight position and radius aperture", () => {
    const controller = new PresentationController(sampleSlides);
    controller.toggleSpotlight();
    expect(controller.currentTool).toBe("spotlight");

    controller.updatePointerPosition(400, 300);
    expect(controller.getSpotlight()).toEqual({
      x: 400,
      y: 300,
      radius: 120,
    });

    controller.setSpotlightRadius(200);
    expect(controller.getSpotlight().radius).toBe(200);
  });

  it("measures presentation elapsed time and flags overtime", () => {
    const controller = new PresentationController(sampleSlides);
    controller.startTimer(60); // 60 seconds target

    const t0 = Date.now();
    expect(controller.isOvertime(t0 + 30000)).toBe(false);
    expect(controller.isOvertime(t0 + 65000)).toBe(true);

    controller.pauseTimer();
    controller.resetTimer();
    expect(controller.getElapsedTimeMs()).toBe(0);
  });

  it("handles standard keyboard presenter shortcuts", () => {
    const controller = new PresentationController(sampleSlides);
    expect(controller.handleKeyDown("ArrowRight")).toBe(true);
    expect(controller.currentSlideIndex).toBe(1);

    expect(controller.handleKeyDown(" ")).toBe(true);
    expect(controller.currentSlideIndex).toBe(2);

    expect(controller.handleKeyDown("ArrowLeft")).toBe(true);
    expect(controller.currentSlideIndex).toBe(1);

    expect(controller.handleKeyDown("l")).toBe(true);
    expect(controller.currentTool).toBe("laser");

    expect(controller.handleKeyDown("Escape")).toBe(true);
    expect(controller.currentTool).toBe("normal");
  });
});
