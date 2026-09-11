declare module 'react-native-keyevent' {
    type KeyEventResponse = {
        keyCode: number;
        action: number;
    };

    export default class KeyEvent {
        static onKeyDownListener(callback: (keyEvent: KeyEventResponse) => void): void;
        static onKeyUpListener(callback: (keyEvent: KeyEventResponse) => void): void;
        static onKeyMultipleListener(callback: (keyEvent: KeyEventResponse) => void): void;
        static removeKeyDownListener(): void;
        static removeKeyUpListener(): void;
        static removeKeyMultipleListener(): void;
    }
}