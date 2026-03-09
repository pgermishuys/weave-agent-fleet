"use client";

import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfirmNewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isCreating?: boolean;
}

export function ConfirmNewSessionDialog({
  open,
  onOpenChange,
  onConfirm,
  isCreating = false,
}: ConfirmNewSessionDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start New Session</AlertDialogTitle>
          <AlertDialogDescription>
            This will create a new session in the same workspace. Your current
            session will be preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isCreating}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isCreating}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {isCreating ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Creating…
              </>
            ) : (
              "New Session"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
