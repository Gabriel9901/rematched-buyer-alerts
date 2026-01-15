"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export type TimeRangeMode = "since_last_run" | "all_time" | "custom";

export interface TimeRangeSelection {
  mode: TimeRangeMode;
  customDateFrom?: string;
  customDateTo?: string;
}

interface TimeRangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (selection: TimeRangeSelection) => void;
  lastRunAt?: string | null;
  debugMode?: boolean;
}

export function TimeRangeDialog({
  open,
  onOpenChange,
  onConfirm,
  lastRunAt,
  debugMode = false,
}: TimeRangeDialogProps) {
  const [mode, setMode] = useState<TimeRangeMode>("since_last_run");
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");

  const formatLastRunDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleConfirm = () => {
    onConfirm({
      mode,
      customDateFrom: mode === "custom" ? customDateFrom : undefined,
      customDateTo: mode === "custom" ? customDateTo : undefined,
    });
    onOpenChange(false);
  };

  // Reset state when dialog opens
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setMode("since_last_run");
      setCustomDateFrom("");
      setCustomDateTo("");
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Select Time Range</DialogTitle>
          <DialogDescription>
            Choose the time period for your search. This affects which listings
            are included.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as TimeRangeMode)}
          >
            {/* Since Last Run Option */}
            <div
              className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-gray-50 cursor-pointer"
              onClick={() => setMode("since_last_run")}
            >
              <RadioGroupItem value="since_last_run" id="since_last_run" />
              <div className="flex-1">
                <Label
                  htmlFor="since_last_run"
                  className="cursor-pointer font-medium"
                >
                  Since last run
                </Label>
                <p className="text-sm text-gray-500">
                  {lastRunAt
                    ? `Only new listings since ${formatLastRunDate(lastRunAt)}`
                    : "Only new listings (last 7 days fallback)"}
                </p>
              </div>
            </div>

            {/* All Time Option */}
            <div
              className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-gray-50 cursor-pointer mt-2"
              onClick={() => setMode("all_time")}
            >
              <RadioGroupItem value="all_time" id="all_time" />
              <div className="flex-1">
                <Label
                  htmlFor="all_time"
                  className="cursor-pointer font-medium"
                >
                  All time (full rescan)
                </Label>
                <p className="text-sm text-gray-500">
                  Search all listings regardless of previous runs
                </p>
              </div>
            </div>

            {/* Custom Range Option */}
            <div
              className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-gray-50 cursor-pointer mt-2"
              onClick={() => setMode("custom")}
            >
              <RadioGroupItem value="custom" id="custom" />
              <div className="flex-1">
                <Label htmlFor="custom" className="cursor-pointer font-medium">
                  Custom date range
                </Label>
                <p className="text-sm text-gray-500 mb-3">
                  Specify exact start and end dates
                </p>

                {mode === "custom" && (
                  <div
                    className="grid grid-cols-2 gap-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div>
                      <Label
                        htmlFor="date-from"
                        className="text-xs text-gray-500"
                      >
                        From
                      </Label>
                      <Input
                        id="date-from"
                        type="date"
                        value={customDateFrom}
                        onChange={(e) => setCustomDateFrom(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label
                        htmlFor="date-to"
                        className="text-xs text-gray-500"
                      >
                        To
                      </Label>
                      <Input
                        id="date-to"
                        type="date"
                        value={customDateTo}
                        onChange={(e) => setCustomDateTo(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </RadioGroup>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            className={
              debugMode
                ? "bg-orange-600 hover:bg-orange-700"
                : "bg-green-600 hover:bg-green-700"
            }
            disabled={mode === "custom" && !customDateFrom}
          >
            {debugMode ? "Start Search (Debug)" : "Start Search"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
