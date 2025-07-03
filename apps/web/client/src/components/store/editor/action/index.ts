import { sendAnalytics } from '@/utils/analytics';
import type { DomElement } from '@onlook/models';
import { EditorMode } from '@onlook/models';
import {
    type Action,
    type EditTextAction,
    type GroupElementsAction,
    type InsertElementAction,
    type InsertImageAction,
    type MoveElementAction,
    type RemoveElementAction,
    type RemoveImageAction,
    type UngroupElementsAction,
    type UpdateStyleAction,
} from '@onlook/models/actions';
import { StyleChangeType } from '@onlook/models/style';
import { assertNever } from '@onlook/utility';
import { debounce, cloneDeep } from 'lodash';
import { toJS } from 'mobx';
import type { EditorEngine } from '../engine';

export class ActionManager {
    constructor(private editorEngine: EditorEngine) { }

    async run(action: Action) {
        await this.editorEngine.history.push(action);
        await this.dispatch(action);
    }

    async undo() {
        console.log('⏪ ActionManager.undo() - PRESSED UNDO BUTTON');
        const action = this.editorEngine.history.undo();

        if (action == null) {
            console.log('❌ ActionManager.undo() - No action to undo');
            return;
        }
        
        console.log('🔄 ActionManager.undo() - Got action from history:', action);
        await this.dispatch(action);
        await this.editorEngine.code.write(action);
        sendAnalytics('undo');
        console.log('✅ ActionManager.undo() - UNDO COMPLETE');
    }

    async redo() {
        console.log('⏩ ActionManager.redo() - PRESSED REDO BUTTON');
        const action = this.editorEngine.history.redo();
        if (action == null) {
            console.log('❌ ActionManager.redo() - No action to redo');
            return;
        }
        
        console.log('🔄 ActionManager.redo() - Got action from history:', action);
        await this.dispatch(action);
        await this.editorEngine.code.write(action);
        sendAnalytics('redo');
        console.log('✅ ActionManager.redo() - REDO COMPLETE');
    }

    private async dispatch(action: Action) {
        console.log('🚀 ActionManager.dispatch() - CALLED');
        console.log('🚀 Action type:', action.type);
        console.log('🚀 Full action:', action);
        
        switch (action.type) {
            case 'update-style':
                console.log('🚀 Dispatching to updateStyle()');
                await this.updateStyle(action);
                break;
            case 'insert-element':
                console.log('🚀 Dispatching to insertElement()');
                await this.insertElement(action);
                break;
            case 'remove-element':
                console.log('🚀 Dispatching to removeElement()');
                await this.removeElement(action);
                break;
            case 'move-element':
                console.log('🚀 Dispatching to moveElement()');
                await this.moveElement(action);
                break;
            case 'edit-text':
                console.log('🚀 Dispatching to editText()');
                await this.editText(action);
                break;
            case 'group-elements':
                console.log('🚀 Dispatching to groupElements()');
                await this.groupElements(action);
                break;
            case 'ungroup-elements':
                console.log('🚀 Dispatching to ungroupElements()');
                await this.ungroupElements(action);
                break;
            case 'write-code':
                console.log('🚀 Skipping write-code action');
                break;
            case 'insert-image':
                console.log('🚀 Dispatching to insertImage()');
                this.insertImage(action);
                break;
            case 'remove-image':
                console.log('🚀 Dispatching to removeImage()');
                this.removeImage(action);
                break;
            default:
                assertNever(action);
        }
        console.log('✅ ActionManager.dispatch() - COMPLETE');
    }

    async updateStyle({ targets }: UpdateStyleAction) {
        console.log('🎨 ActionManager.updateStyle() - CALLED');
        console.log('📥 Targets to update:', targets);
        
        const domEls: DomElement[] = [];
        for (const target of targets) {
            console.log(`🎯 Processing target: ${target.domId}`);
            console.log(`🎯 Target change:`, target.change);
            
            const frameData = this.editorEngine.frames.get(target.frameId);
            if (!frameData) {
                console.error('Failed to get frameView');
                return;
            }
            const convertedChange = Object.fromEntries(
                Object.entries(target.change.updated).map(([key, value]) => {
                    if (value.type === StyleChangeType.Custom) {
                        const resolved = this.editorEngine.theme.getColorByName(value.value);

                        if (resolved) {
                            value.value = resolved;
                            value.type  = StyleChangeType.Value;
                        } else if (/^(#|rgb|hsl)/i.test(value.value)) {
                            value.type = StyleChangeType.Value;
                        } else {
                            console.warn(`Unknown design token: ${value.value}`);
                        }
                    }
                    return [key, value];
                }),
            );
            const change = {
                original: target.change.original,
                updated: convertedChange,
            };
            
            console.log(`📝 Applying change to DOM:`, change);
            console.log("stringified change", JSON.stringify(change));
            console.log("frameData", frameData);
            // cloneDeep is used to avoid the issue of observable values can not pass through the webview
            const domEl = await frameData.view.updateStyle(target.domId, cloneDeep(change));
            if (!domEl) {
                console.error('Failed to update style');
                continue;
            }

            console.log(`✅ DOM updated, returned element styles:`, domEl.styles);
            domEls.push(domEl);
        }

        this.refreshDomElement(domEls);
        console.log('✅ ActionManager.updateStyle() - COMPLETE');
    }

    debouncedRefreshDomElement(domEls: DomElement[]) {
        this.editorEngine.elements.click(domEls);
    }

    refreshDomElement = debounce(this.debouncedRefreshDomElement, 100, { leading: true });

    private async insertElement({ targets, element, editText, location }: InsertElementAction) {
        for (const elementMetadata of targets) {
            const frameView = this.editorEngine.frames.get(elementMetadata.frameId);
            if (!frameView) {
                console.error('Failed to get frameView');
                return;
            }

            try {
                const domEl = await frameView.view.insertElement(element, location);
                if (!domEl) {
                    console.error('Failed to insert element');
                    return;
                }

                this.refreshAndClickMutatedElement(domEl);
            } catch (err) {
                console.error('Error inserting element:', err);
            }
        }
    }

    private async removeElement({ targets, location }: RemoveElementAction) {
        for (const target of targets) {
            const frameView = this.editorEngine.frames.get(target.frameId);
            if (!frameView) {
                console.error('Failed to get frameView');
                return;
            }

            const domEl = await frameView.view.removeElement(location);

            if (!domEl) {
                console.error('Failed to remove element');
                return;
            }

            await this.editorEngine.overlay.refresh();

            this.refreshAndClickMutatedElement(domEl);
        }
    }

    private async moveElement({ targets, location }: MoveElementAction) {
        for (const target of targets) {
            const frameView = this.editorEngine.frames.get(target.frameId);
            if (!frameView) {
                console.error('Failed to get frameView');
                return;
            }
            const domEl = await frameView.view.moveElement(target.domId, location.index);
            if (!domEl) {
                console.error('Failed to move element');
                return;
            }
            this.refreshAndClickMutatedElement(domEl);
        }
    }

    private async editText({ targets, newContent }: EditTextAction) {
        for (const target of targets) {
            const frameView = this.editorEngine.frames.get(target.frameId);
            if (!frameView) {
                console.error('Failed to get frameView');
                return;
            }
            const domEl = await frameView.view.editText(target.domId, newContent);
            if (!domEl) {
                console.error('Failed to edit text');
                return;
            }

            this.refreshAndClickMutatedElement(domEl);
        }
    }

    private async groupElements({ parent, container, children }: GroupElementsAction) {
        const frameView = this.editorEngine.frames.get(parent.frameId);
        if (!frameView) {
            console.error('Failed to get frameView');
            return;
        }

        const domEl = (await frameView.view.groupElements(
            parent,
            container,
            children,
        )) as DomElement;

        if (!domEl) {
            console.error('Failed to group elements');
            return;
        }

        this.refreshAndClickMutatedElement(domEl);
    }

    private async ungroupElements({ parent, container }: UngroupElementsAction) {
        const frameView = this.editorEngine.frames.get(parent.frameId);
        if (!frameView) {
            console.error('Failed to get frameView');
            return;
        }

        const domEl = (await frameView.view.ungroupElements(parent, container)) as DomElement;

        if (!domEl) {
            console.error('Failed to ungroup elements');
            return;
        }

        this.refreshAndClickMutatedElement(domEl);
    }

    private insertImage({ targets, image }: InsertImageAction) {
        targets.forEach((target) => {
            const frameView = this.editorEngine.frames.get(target.frameId);
            if (!frameView) {
                console.error('Failed to get frameView');
                return;
            }
            // sendToWebview(frameView, WebviewChannels.INSERT_IMAGE, {
            //     domId: target.domId,
            //     image,
            // });
        });
    }

    private removeImage({ targets }: RemoveImageAction) {
        targets.forEach((target) => {
            const frameView = this.editorEngine.frames.get(target.frameId);
            if (!frameView) {
                console.error('Failed to get frameView');
                return;
            }
            // sendToWebview(frameView, WebviewChannels.REMOVE_IMAGE, {
            //     domId: target.domId,
            // });
        });
    }

    async refreshAndClickMutatedElement(
        domEl: DomElement,
        // newMap: Map<string, LayerNode>,
        // frameData: FrameData,
    ) {
        this.editorEngine.state.editorMode = EditorMode.DESIGN;
        // await this.editorEngine.ast.refreshAstDoc(frameData.view);
        this.editorEngine.elements.click([domEl]);
        // this.editorEngine.ast.updateMap(frameData.view.id, newMap, domEl.domId);
    }

    clear() {
        this.editorEngine.history.clear();
    }
}