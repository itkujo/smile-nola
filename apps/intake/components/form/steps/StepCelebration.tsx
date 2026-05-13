"use client";

import { motion } from "framer-motion";
import { useFormContext, useWatch } from "react-hook-form";
import { TextField } from "@/components/form/fields/TextField";
import { DateField } from "@/components/form/fields/DateField";
import { StepHeader } from "@/components/form/StepHeader";
import { StepActions } from "@/components/form/StepActions";
import { VenueAutocomplete, type VenueValue } from "@/components/form/VenueAutocomplete";
import { fieldStaggerContainer, fieldStaggerItem } from "@/lib/motion";
import type { Lead } from "@/lib/schema";

interface Props {
  onBack: () => void;
  onNext: () => void;
}

const FIELDS_THIS_STEP = [
  "partner1Name",
  "partner2Name",
  "eventDate",
  "venueName",
] as const;

export function StepCelebration({ onBack, onNext }: Props) {
  const {
    register,
    trigger,
    control,
    setValue,
    formState: { errors },
  } = useFormContext<Lead>();

  // Watch all venue fields so the autocomplete value stays in sync if the
  // user navigates back to this step.
  const venueName = useWatch({ control, name: "venueName" }) ?? "";
  const venueStreetAddress = useWatch({ control, name: "venueStreetAddress" }) ?? null;
  const venueCity = useWatch({ control, name: "venueCity" }) ?? null;
  const venueState = useWatch({ control, name: "venueState" }) ?? null;
  const venuePostalCode = useWatch({ control, name: "venuePostalCode" }) ?? null;
  const venueCountry = useWatch({ control, name: "venueCountry" }) ?? null;
  const venueLatitude = useWatch({ control, name: "venueLatitude" }) ?? null;
  const venueLongitude = useWatch({ control, name: "venueLongitude" }) ?? null;

  const venueValue: VenueValue = {
    name: venueName,
    streetAddress: venueStreetAddress,
    city: venueCity,
    state: venueState,
    postalCode: venuePostalCode,
    country: venueCountry,
    latitude: venueLatitude,
    longitude: venueLongitude,
  };

  function onVenueChange(v: VenueValue) {
    setValue("venueName", v.name, { shouldValidate: false, shouldDirty: true });
    setValue("venueStreetAddress", v.streetAddress ?? undefined);
    setValue("venueCity", v.city ?? undefined);
    setValue("venueState", v.state ?? undefined);
    setValue("venuePostalCode", v.postalCode ?? undefined);
    setValue("venueCountry", v.country ?? undefined);
    setValue("venueLatitude", v.latitude ?? undefined);
    setValue("venueLongitude", v.longitude ?? undefined);
  }

  const handleNext = async () => {
    const valid = await trigger([...FIELDS_THIS_STEP], { shouldFocus: true });
    if (valid) onNext();
  };

  // Set min date to today (today's local YYYY-MM-DD)
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <StepHeader
        eyebrow="02 — About the celebration"
        headline="the moment itself"
        subhead="Two of you (or one for now), the date, and the place — if you've picked one."
      />

      <motion.div
        variants={fieldStaggerContainer}
        initial="hidden"
        animate="visible"
        className="flex-1 min-h-0 overflow-y-auto sn-step-content flex flex-col sn-step-gap max-w-md mx-auto w-full"
      >
        <motion.div variants={fieldStaggerItem}>
          <TextField
            label="Partner 1"
            required
            autoComplete="off"
            placeholder="First name"
            error={errors.partner1Name?.message}
            {...register("partner1Name")}
          />
        </motion.div>

        <motion.div variants={fieldStaggerItem}>
          <TextField
            label="Partner 2"
            autoComplete="off"
            placeholder="First name"
            helper="Optional — leave blank if it's just you for now."
            error={errors.partner2Name?.message}
            {...register("partner2Name")}
          />
        </motion.div>

        <motion.div variants={fieldStaggerItem}>
          <DateField
            label="Event date"
            required
            min={todayIso}
            error={errors.eventDate?.message}
            {...register("eventDate")}
          />
        </motion.div>

        <motion.div variants={fieldStaggerItem}>
          <VenueAutocomplete
            id="venue-name"
            label="Venue"
            placeholder="Start typing a venue name…"
            helper="Optional — pick from suggestions or type 'TBD' if undecided."
            value={venueValue}
            onChange={onVenueChange}
          />
        </motion.div>
      </motion.div>

      <div className="max-w-md mx-auto w-full">
        <StepActions onBack={onBack} onNext={handleNext} />
      </div>
    </div>
  );
}
