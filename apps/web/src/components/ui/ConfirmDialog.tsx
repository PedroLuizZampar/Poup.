import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialogState({
        isOpen: true,
        options,
        resolve,
      });
    });
  }, []);

  function handleClose(result: boolean) {
    if (dialogState) {
      dialogState.resolve(result);
      setDialogState(null);
    }
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {dialogState && (
        <Modal
          isOpen={dialogState.isOpen}
          onClose={() => handleClose(false)}
          title={dialogState.options.title}
          maxWidth="sm"
          footer={
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleClose(false)}
              >
                {dialogState.options.cancelText || "Cancelar"}
              </Button>
              <Button
                variant={dialogState.options.danger ? "danger" : "primary"}
                size="sm"
                onClick={() => handleClose(true)}
              >
                {dialogState.options.confirmText || "Confirmar"}
              </Button>
            </>
          }
        >
          {dialogState.options.message && (
            <div className="text-xs md:text-sm text-text-secondary whitespace-pre-line leading-relaxed">
              {dialogState.options.message}
            </div>
          )}
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm deve ser usado dentro de um ConfirmProvider");
  }
  return context.confirm;
}
