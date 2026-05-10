"use client";

import { motion } from "framer-motion";
import { useFormContext } from "react-hook-form";
import { ChipSelector } from "@/components/form/fields/ChipSelector";
import { CollectionCardGrid } from "@/components/form/fields/CollectionCard";
import { Textarea } from "@/components/form/fields/Textarea";
import { StepHeader } from "@/components/form/StepHeader";
import { StepActions } from "@/components/form/StepActions";
import { fieldStaggerContainer, fieldStaggerItem } from "@/lib/motion";
import {
  SETTINGS,
  type CollectionId,
  type Lead,
} from "@/lib/schema";

interface Props {
  onBack: () => void;
  onSubmit: () => void;
  loading: boolean;
}

const FIELDS_THIS_STEP = ["setting", "collectionsInterested", "notes"] as const;

export function StepDream({ onBack, onSubmit, loading }: Props) {
  const {
    register,
    watch,
    setValue,
    trigger,
    formState: { errors },
  } = useFormContext<Lead>();

  const setting = watch("setting");
  const collections = watch("collectionsInterested") ?? [];

  const toggleCollection = (id: CollectionId) => {
    const current = collections;
    const next = current.includes(id)
      ? current.filter((c) => c !== id)
      : [...current, id];
    setValue("collectionsInterested", next, { shouldValidate: true });
  };

  const handleSubmit = async () => {
    const valid = await trigger([...FIELDS_THIS_STEP], { shouldFocus: true });
    if (valid) onSubmit();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <StepHeader
        eyebrow="03 — Setting the scene"
        headline="your vision"
        subhead="Indoors, outdoors, the experiences you're drawn to. Anything else you want us to know."
      />

      <motion.div
        variants={fieldStaggerContainer}
        initial="hidden"
        animate="visible"
        className="flex-1 min-h-0 overflow-y-auto sn-step-content flex flex-col sn-step-gap max-w-xl mx-auto w-full"
      >
        <motion.div variants={fieldStaggerItem}>
          <ChipSelector
            label="Setting"
            name="setting"
            options={SETTINGS}
            value={setting}
            onChange={(v) =>
              setValue("setting", v as Lead["setting"], {
                shouldValidate: true,
              })
            }
            error={errors.setting?.message}
          />
        </motion.div>

        <motion.div variants={fieldStaggerItem}>
          <CollectionCardGrid
            values={collections}
            onToggle={toggleCollection}
            error={errors.collectionsInterested?.message as string | undefined}
          />
        </motion.div>

        <motion.div variants={fieldStaggerItem}>
          <Textarea
            label="Anything else we should know?"
            placeholder="The vibe, must-haves, surprises…"
            rows={3}
            error={errors.notes?.message}
            {...register("notes")}
          />
        </motion.div>
      </motion.div>

      <div className="max-w-xl mx-auto w-full">
        <StepActions
          onBack={onBack}
          onNext={handleSubmit}
          nextLabel={loading ? "Sending…" : "Send Inquiry"}
          loading={loading}
        />
      </div>
    </div>
  );
}
