// Type declarations for external libraries used in Classifast

declare global {
  interface Window {
    Clerk?: ClerkInstance;
    __internal_ClerkUICtor?: unknown;
  }

  // ============================================
  // Clerk Authentication SDK
  // ============================================
  interface ClerkLoadOptions {
    ui?: {
      ClerkUI: NonNullable<Window["__internal_ClerkUICtor"]>;
    };
  }

  interface ClerkInstance {
    load: (options?: ClerkLoadOptions) => Promise<void>;
    session?: ClerkSession;
    user?: ClerkUser;
    addListener: (
      callback: (payload: ClerkListenerPayload) => void,
    ) => () => void;
    mountUserButton: (
      element: HTMLElement,
      options?: UserButtonOptions,
    ) => void;
    openSignIn: (options?: SignInOptions) => void;
    openSignUp: (options?: SignUpOptions) => void;
    openGoogleOneTap: (params?: GoogleOneTapParams) => void;
  }

  interface ClerkSession {
    getToken: (options?: {
      skipCache?: boolean;
      expirationBufferSeconds?: number;
      template?: string;
    }) => Promise<string | null>;
  }

  interface ClerkUser {
    id: string;
    firstName?: string;
    lastName?: string;
    emailAddresses?: Array<{ emailAddress: string }>;
    imageUrl?: string;
  }

  interface ClerkListenerPayload {
    user?: ClerkUser;
    session?: ClerkSession;
  }

  interface UserButtonOptions {
    appearance?: {
      elements?: {
        userButtonAvatarBox?: string;
        userButtonBox?: string;
        userButtonTrigger?: string;
      };
    };
  }

  interface SignInOptions {
    redirectUrl?: string;
  }

  interface SignUpOptions {
    redirectUrl?: string;
  }

  interface GoogleOneTapParams {
    cancelOnTapOutside?: boolean;
    itpSupport?: boolean;
    fedCmSupport?: boolean;
  }
}

export {};
