"use client";

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
import { useFleetConnections } from "@/hooks/use-fleet-connections";
import type { FleetConnection } from "@/lib/fleet-connection-registry";

interface RemoveServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: FleetConnection;
}

export function RemoveServerDialog({
  open,
  onOpenChange,
  connection,
}: RemoveServerDialogProps) {
  const { removeConnection } = useFleetConnections();

  const handleConfirm = () => {
    removeConnection(connection.id);
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {connection.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Any sessions on this server will no longer be visible.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
