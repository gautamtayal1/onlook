import { sendAnalytics } from '@/utils/analytics';
import type { Action } from '@onlook/models/actions';
import { jsonClone } from '@onlook/utility';
import { makeAutoObservable } from 'mobx';
import type { EditorEngine } from '../engine';
import { transformRedoAction, undoAction, updateTransactionActions } from './helpers';

enum TransactionType {
    IN_TRANSACTION = 'in-transaction',
    NOT_IN_TRANSACTION = 'not-in-transaction',
}

interface InTransaction {
    type: TransactionType.IN_TRANSACTION;
    actions: Action[];
}

interface NotInTransaction {
    type: TransactionType.NOT_IN_TRANSACTION;
}

type TransactionState = InTransaction | NotInTransaction;

export class HistoryManager {
    constructor(
        private editorEngine: EditorEngine,
        private undoStack: Action[] = [],
        private redoStack: Action[] = [],
        private inTransaction: TransactionState = { type: TransactionType.NOT_IN_TRANSACTION },
    ) {
        makeAutoObservable(this);
    }

    get canUndo() {
        return this.undoStack.length > 0;
    }

    get canRedo() {
        return this.redoStack.length > 0;
    }

    get isInTransaction() {
        return this.inTransaction.type === TransactionType.IN_TRANSACTION;
    }

    get length() {
        return this.undoStack.length;
    }

    startTransaction = () => {
        this.inTransaction = { type: TransactionType.IN_TRANSACTION, actions: [] };
    };

    commitTransaction = async () => {
        if (
            this.inTransaction.type === TransactionType.NOT_IN_TRANSACTION ||
            this.inTransaction.actions.length === 0
        ) {
            this.inTransaction = { type: TransactionType.NOT_IN_TRANSACTION };
            return;
        }

        const actionsToCommit = this.inTransaction.actions;
        this.inTransaction = { type: TransactionType.NOT_IN_TRANSACTION };
        for (const action of actionsToCommit) {
            await this.push(action);
        }
    };

    push = async (action: Action) => {
        if (this.inTransaction.type === TransactionType.IN_TRANSACTION) {
            this.inTransaction.actions = updateTransactionActions(
                this.inTransaction.actions,
                action,
            );
            return;
        }

        if (this.redoStack.length > 0) {
            this.redoStack = [];
        }

        this.undoStack.push(action);
        await this.editorEngine.code.write(action);

        switch (action.type) {
            case 'update-style':
                sendAnalytics('style action', {
                    style: jsonClone(
                        action.targets.length > 0 ? action.targets[0]?.change.updated : {},
                    ),
                });
                break;
            case 'insert-element':
                sendAnalytics('insert action');
                break;
            case 'move-element':
                sendAnalytics('move action');
                break;
            case 'remove-element':
                sendAnalytics('remove action');
                break;
            case 'edit-text':
                sendAnalytics('edit text action');
        }
    };

    undo = (): Action | null => {
        console.log('📚 HistoryManager.undo() - CALLED');
        console.log('📚 Undo stack length:', this.undoStack);
        console.log('📚 Undo stack content:', this.undoStack.slice()); // Convert to plain array
        console.log('📚 Redo stack length:', this.redoStack);
        console.log('📚 Redo stack content:', this.redoStack.slice()); // Convert to plain array
        
        if (this.inTransaction.type === TransactionType.IN_TRANSACTION) {
            console.log('📚 In transaction, committing first...');
            this.commitTransaction();
        }

        const top = this.undoStack.pop();
        if (top == null) {
            console.log('❌ HistoryManager.undo() - No action to undo');
            return null;
        }
        
        console.log('📚 Original action to undo:', JSON.parse(JSON.stringify(top))); // Convert to plain object
        const action = undoAction(top);
        console.log('📚 Reversed action to apply:', JSON.parse(JSON.stringify(action))); // Convert to plain object

        this.redoStack.push(top);
        console.log('📚 Moved original action to redo stack');

        return action;
    };

    redo = (): Action | null => {
        console.log('📚 HistoryManager.redo() - CALLED');
        console.log('📚 Undo stack length:', this.undoStack.length);
        console.log('📚 Undo stack content:', this.undoStack.slice()); // Convert to plain array
        console.log('📚 Redo stack length:', this.redoStack.length);
        console.log('📚 Redo stack content:', this.redoStack.slice()); // Convert to plain array
        
        if (this.inTransaction.type === TransactionType.IN_TRANSACTION) {
            console.log('📚 In transaction, committing first...');
            this.commitTransaction();
        }

        const top = this.redoStack.pop();
        if (top == null) {
            console.log('❌ HistoryManager.redo() - No action to redo');
            return null;
        }

        console.log('📚 Original action to redo:', JSON.parse(JSON.stringify(top))); // Convert to plain object
        const action = transformRedoAction(top);
        console.log('📚 Transformed action to apply:', JSON.parse(JSON.stringify(action))); // Convert to plain object
        
        this.undoStack.push(action);
        console.log('📚 Moved transformed action to undo stack');
        
        return action;
    };

    clear = () => {
        this.undoStack = [];
        this.redoStack = [];
    };
}
