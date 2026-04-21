import React, { forwardRef } from 'react';
import { useWatch } from 'react-hook-form';
import type { Control } from 'react-hook-form';
import { EditIcon, TooltipAnchor } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type SendCanvasButtonProps = {
  disabled: boolean;
  control: Control<{ text: string }>;
  onCanvasSend: () => void;
};

const CanvasSubmitButton = React.memo(
  forwardRef(
    (
      props: { disabled: boolean; onCanvasSend: () => void },
      ref: React.ForwardedRef<HTMLButtonElement>,
    ) => {
      const localize = useLocalize();
      return (
        <TooltipAnchor
          description={localize('com_ui_send_to_canvas')}
          render={
            <button
              ref={ref}
              aria-label={localize('com_ui_send_to_canvas')}
              id="send-canvas-button"
              disabled={props.disabled}
              onClick={props.onCanvasSend}
              className={cn(
                'rounded-full bg-brand-blue p-1.5 text-white outline-offset-4 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-10',
              )}
              data-testid="send-canvas-button"
              type="button"
            >
              <span className="" data-state="closed">
                <EditIcon size={24} />
              </span>
            </button>
          }
        />
      );
    },
  ),
);

const SendCanvasButton = React.memo(
  forwardRef((props: SendCanvasButtonProps, ref: React.ForwardedRef<HTMLButtonElement>) => {
    const data = useWatch({ control: props.control });
    const content = data?.text?.trim();
    return (
      <CanvasSubmitButton
        ref={ref}
        disabled={props.disabled || !content}
        onCanvasSend={props.onCanvasSend}
      />
    );
  }),
);

export default SendCanvasButton;
