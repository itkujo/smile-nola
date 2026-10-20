import { Rise, fieldDelay } from "@/components/booth/Rise";
import { TextField } from "@/components/booth/form/fields/TextField";
import { DateField } from "@/components/booth/form/fields/DateField";
import { StepHeader } from "@/components/booth/form/StepHeader";
import { StepActions } from "@/components/booth/form/StepActions";
import { VenueAutocomplete, type VenueValue } from "@/components/booth/form/VenueAutocomplete";
import { useLeadFormContext } from "@/components/booth/form/useLeadForm";

interface Props {
  onBack: () => void;
  onNext: () => void;
}

const FIELDS_THIS_STEP = ["partner1Name", "partner2Name", "eventDate", "venueName"] as const;

export function StepCelebration({ onBack, onNext }: Props) {
  const { register, trigger, setValue, watch, errors } = useLeadFormContext();

  // Keep the autocomplete in sync if the visitor navigates back to this step.
  const venueValue: VenueValue = {
    name: watch("venueName") ?? "",
    streetAddress: watch("venueStreetAddress") ?? null,
    city: watch("venueCity") ?? null,
    state: watch("venueState") ?? null,
    postalCode: watch("venuePostalCode") ?? null,
    country: watch("venueCountry") ?? null,
    latitude: watch("venueLatitude") ?? null,
    longitude: watch("venueLongitude") ?? null,
  };

  function onVenueChange(v: VenueValue) {
    setValue("venueName", v.name);
    setValue("venueStreetAddress", v.streetAddress ?? undefined);
    setValue("venueCity", v.city ?? undefined);
    setValue("venueState", v.state ?? undefined);
    setValue("venuePostalCode", v.postalCode ?? undefined);
    setValue("venueCountry", v.country ?? undefined);
    setValue("venueLatitude", v.latitude ?? undefined);
    setValue("venueLongitude", v.longitude ?? undefined);
  }

  const handleNext = () => {
    if (trigger(FIELDS_THIS_STEP, { shouldFocus: true })) onNext();
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

      <div className="flex-1 min-h-0 overflow-y-auto sn-step-content flex flex-col sn-step-gap max-w-md mx-auto w-full">
        <Rise delay={fieldDelay(0)}>
          <TextField
            label="Partner 1"
            required
            autoComplete="off"
            placeholder="First name"
            error={errors.partner1Name?.message}
            {...register("partner1Name")}
          />
        </Rise>

        <Rise delay={fieldDelay(1)}>
          <TextField
            label="Partner 2"
            autoComplete="off"
            placeholder="First name"
            helper="Optional — leave blank if it's just you for now."
            error={errors.partner2Name?.message}
            {...register("partner2Name")}
          />
        </Rise>

        <Rise delay={fieldDelay(2)}>
          <DateField
            label="Event date"
            required
            min={todayIso}
            error={errors.eventDate?.message}
            {...register("eventDate")}
          />
        </Rise>

        <Rise delay={fieldDelay(3)}>
          <VenueAutocomplete
            id="venue-name"
            label="Venue"
            placeholder="Start typing a venue name…"
            helper="Optional — pick from suggestions or type 'TBD' if undecided."
            value={venueValue}
            onChange={onVenueChange}
          />
        </Rise>
      </div>

      <div className="max-w-md mx-auto w-full">
        <StepActions onBack={onBack} onNext={handleNext} />
      </div>
    </div>
  );
}
