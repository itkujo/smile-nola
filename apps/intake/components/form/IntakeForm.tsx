"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LeadSchema, type Lead } from "@/lib/schema";
import { stepVariants } from "@/lib/motion";
import { Progress } from "@/components/form/Progress";
import { DecoCorner } from "@/components/brand/DecoCorner";
import { DensityToggle } from "@/components/brand/DensityToggle";
import { StepWelcome } from "@/components/form/steps/StepWelcome";
import { StepPOC } from "@/components/form/steps/StepPOC";
import { StepCelebration } from "@/components/form/steps/StepCelebration";
import { StepDream } from "@/components/form/steps/StepDream";
import { StepThankYou } from "@/components/form/steps/StepThankYou";

type StepIndex = 0 | 1 | 2 | 3 | 4; // 0=welcome, 1=POC, 2=Celebration, 3=Dream, 4=ThankYou

const PROGRESS_STEPS = 3; // POC, Celebration, Dream

const DEFAULT_VALUES: Partial<Lead> = {
  pocName: "",
  pocEmail: "",
  pocPhone: "",
  partner1Name: "",
  partner2Name: "",
  eventDate: "",
  venueName: "",
  venueStreetAddress: undefined,
  venueCity: undefined,
  venueState: undefined,
  venuePostalCode: undefined,
  venueCountry: undefined,
  venueLatitude: undefined,
  venueLongitude: undefined,
  collectionsInterested: [],
  notes: "",
};

const IDLE_RESET_MS = 1000 * 60 * 3; // 3 minutes idle → reset to welcome

export function IntakeForm() {
  const [step, setStep] = useState<StepIndex>(0);
  const [direction, setDirection] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const methods = useForm<Lead>({
    resolver: zodResolver(LeadSchema),
    defaultValues: DEFAULT_VALUES,
    mode: "onTouched",
    shouldFocusError: true,
  });

  // Idle timer: if the form sits with stale data on a non-welcome step for
  // more than IDLE_RESET_MS, return to welcome. Reset on any user input.
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goTo = useCallback((next: StepIndex) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
    setSubmitError(null);
  }, [step]);

  const reset = useCallback(() => {
    methods.reset(DEFAULT_VALUES);
    setDirection(-1);
    setStep(0);
    setSubmitError(null);
  }, [methods]);

  useEffect(() => {
    const arm = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      // Only auto-reset away from welcome and thank-you screens
      if (step === 0 || step === 4) return;
      idleTimerRef.current = setTimeout(reset, IDLE_RESET_MS);
    };
    const events: (keyof DocumentEventMap)[] = [
      "pointerdown",
      "keydown",
      "touchstart",
    ];
    arm();
    events.forEach((e) => document.addEventListener(e, arm, { passive: true }));
    return () => {
      events.forEach((e) => document.removeEventListener(e, arm));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [step, reset]);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const data = methods.getValues();
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.ok) {
        const message =
          payload?.error ||
          "We couldn't save your inquiry. Please try once more.";
        setSubmitError(message);
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      setDirection(1);
      setStep(4);
    } catch (err) {
      console.error("[intake] submit failed:", err);
      setSubmitError(
        "We couldn't reach the server. Check Wi-Fi and try once more.",
      );
      setSubmitting(false);
    }
  }, [methods, submitting]);

  const partner1 = methods.watch("partner1Name") ?? "";
  const partner2 = methods.watch("partner2Name");

  // Progress visible on the three filling steps (1, 2, 3)
  const progressVisible = step >= 1 && step <= 3;
  const progressCurrent = Math.max(0, step - 1); // 0,1,2

  const isFillingStep = step >= 1 && step <= 3;

  return (
    <FormProvider {...methods}>
      <div className="sn-viewport relative w-full overflow-hidden">
        {/* Ambient atmosphere */}
        <span
          className="ambient-glow"
          aria-hidden="true"
          style={{ opacity: isFillingStep ? 0.55 : 1 }}
        />

        {/* Top toolbar — density toggle (left) + progress (center). Always visible. */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-start justify-between gap-4 px-4 sm:px-6 pt-3 sm:pt-4 pointer-events-none">
          <div className="pointer-events-auto">
            <DensityToggle />
          </div>
          <div className="flex-1 max-w-md mx-auto pt-1">
            <Progress
              currentStep={progressCurrent}
              totalSteps={PROGRESS_STEPS}
              visible={progressVisible}
            />
          </div>
          {/* Spacer to balance the toggle width */}
          <div className="w-[88px] shrink-0" aria-hidden="true" />
        </div>

        {/* Submission error toast */}
        <AnimatePresence>
          {submitError && (
            <motion.div
              role="alert"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-16 left-1/2 -translate-x-1/2 z-30 max-w-md w-[90%] px-4 py-3 rounded-md border border-[color:var(--sn-amber)] bg-[color:var(--sn-soft-black)] text-[color:var(--sn-amber)] text-sm font-body text-center"
            >
              {submitError}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main shell — viewport height, three regions handled per-step */}
        <div className="relative h-full w-full flex items-center justify-center px-3 sm:px-6 pt-14 pb-4">
          <div className="relative w-full max-w-3xl h-full max-h-full flex flex-col">
            {/* Card frame on filling steps */}
            {isFillingStep && (
              <div className="absolute inset-0 brand-card rounded-md pointer-events-none">
                <span className="absolute -top-px -left-px text-[color:var(--sn-gold)]">
                  <DecoCorner position="tl" size={22} />
                </span>
                <span className="absolute -top-px -right-px text-[color:var(--sn-gold)]">
                  <DecoCorner position="tr" size={22} />
                </span>
                <span className="absolute -bottom-px -left-px text-[color:var(--sn-gold)]">
                  <DecoCorner position="bl" size={22} />
                </span>
                <span className="absolute -bottom-px -right-px text-[color:var(--sn-gold)]">
                  <DecoCorner position="br" size={22} />
                </span>
              </div>
            )}

            <div
              className="relative flex-1 min-h-0 flex flex-col"
              style={
                isFillingStep
                  ? {
                      paddingLeft: "var(--sn-step-padding-x)",
                      paddingRight: "var(--sn-step-padding-x)",
                      paddingTop: "var(--sn-step-padding-y)",
                      paddingBottom: "var(--sn-step-padding-y)",
                    }
                  : undefined
              }
            >
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={step}
                  custom={direction}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="flex-1 min-h-0 flex flex-col"
                >
                  {step === 0 && (
                    <StepWelcome onBegin={() => goTo(1)} />
                  )}
                  {step === 1 && (
                    <StepPOC onNext={() => goTo(2)} />
                  )}
                  {step === 2 && (
                    <StepCelebration
                      onBack={() => goTo(1)}
                      onNext={() => goTo(3)}
                    />
                  )}
                  {step === 3 && (
                    <StepDream
                      onBack={() => goTo(2)}
                      onSubmit={handleSubmit}
                      loading={submitting}
                    />
                  )}
                  {step === 4 && (
                    <StepThankYou
                      partner1={partner1}
                      partner2={partner2}
                      onReset={reset}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </FormProvider>
  );
}
