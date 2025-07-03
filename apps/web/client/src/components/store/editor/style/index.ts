import type { DomElement, DomElementStyles, Font } from '@onlook/models';
import {
    type Change,
    type StyleActionTarget,
    type UpdateStyleAction,
} from '@onlook/models/actions';
import { StyleChangeType, type StyleChange } from '@onlook/models/style';
import { makeAutoObservable, reaction } from 'mobx';
import type { CSSProperties } from 'react';
import type { EditorEngine } from '../engine';
import { convertFontString } from '@onlook/utility';

export interface SelectedStyle {
    styles: DomElementStyles;
    parentRect: DOMRect;
    rect: DOMRect;
}

export enum StyleMode {
    Instance = 'instance',
    Root = 'root',
}

export class StyleManager {
    selectedStyle: SelectedStyle | null = null;
    domIdToStyle = new Map<string, SelectedStyle>();
    prevSelected = '';
    mode: StyleMode = StyleMode.Root;

    constructor(private editorEngine: EditorEngine) {
        makeAutoObservable(this);
        reaction(
            () => this.editorEngine.elements.selected,
            (selectedElements) => this.onSelectedElementsChanged(selectedElements),
        );
    }

    updateCustom(style: string, value: string, domIds: string[] = []) {
        console.log('🎨 StyleManager.updateCustom() - CALLED');
        console.log('📥 Input style:', style);
        console.log('📥 Input value:', value);
        console.log('📥 domIds:', domIds);
        const styleObj = { [style]: value };
        const action = this.getUpdateStyleAction(styleObj, domIds, StyleChangeType.Custom);
        this.editorEngine.action.run(action);
        this.updateStyleNoAction(styleObj);
    }

    update(style: string, value: string) {
        console.log('🎨 StyleManager.update() - CALLED');
        console.log('📥 Input style:', style);
        console.log('📥 Input value:', value);
        this.updateMultiple({ [style]: value });
    }

    updateMultiple(styles: Record<string, string>) {
        console.log('🎨 StyleManager.updateMultiple() - CALLED');
        console.log('📥 Input styles:', styles);
        const action = this.getUpdateStyleAction(styles);
        this.editorEngine.action.run(action);
        this.updateStyleNoAction(styles);
    }

    updateFontFamily(style: string, value: Font) {
        const styleObj = { [style]: value.id };
        
        const action = this.getUpdateStyleAction(styleObj);
        const formattedAction = {
            ...action,
            targets: action.targets.map((val) => ({
                ...val,
                change: {
                    original: Object.fromEntries(
                        Object.entries(val.change.original).map(([key, styleChange]) => [
                            key,
                            {
                                ...styleChange,
                                value: convertFontString(styleChange.value),
                            },
                        ]),
                    ),
                    updated: Object.fromEntries(
                        Object.entries(val.change.updated).map(([key, styleChange]) => [
                            key,
                            {
                                ...styleChange,
                                value: convertFontString(styleChange.value),
                            },
                        ]),
                    ),
                },
            })),
        };
        this.editorEngine.action.run(formattedAction);
    }

    getUpdateStyleAction(
        styles: CSSProperties,
        domIds: string[] = [],
        type: StyleChangeType = StyleChangeType.Value,
    ): UpdateStyleAction {
        console.log('🎨 StyleManager.getUpdateStyleAction() - CALLED');
        console.log('📥 Input styles:', styles);
        console.log('📥 domIds:', domIds);
        console.log('📥 type:', type);
        
        if (!this.editorEngine) {
            console.log('❌ No editorEngine');
            return {
                type: 'update-style',
                targets: [],
            };
        }
        
        const selected = this.editorEngine.elements.selected;
        console.log('📊 Selected elements count:', selected);
        
        const filteredSelected =
            domIds.length > 0 ? selected.filter((el) => domIds.includes(el.domId)) : selected;
        console.log('📊 Filtered selected count:', filteredSelected);

        const targets: Array<StyleActionTarget> = filteredSelected.map((selectedEl) => {
            console.log('🎯 Processing element:', selectedEl.domId);
            console.log('🎯 Element cached styles:', selectedEl.styles);
            
            const change: Change<Record<string, StyleChange>> = {
                updated:
                    Object.fromEntries(
                        Object.keys(styles).map((style) => {
                            const value = styles[style as keyof CSSProperties]?.toString() ?? '';
                            console.log(`📝 Updated ${style}:`, value);
                            return [
                                style,
                                {
                                    value: value,
                                    type: type === StyleChangeType.Custom ? StyleChangeType.Custom : StyleChangeType.Value,
                                },
                            ];
                        }),
                    ),
                original: Object.fromEntries(
                    Object.keys(styles).map((style) => {
                        // Get FRESH current value from DOM instead of stale cache
                        let currentValue = this.getFreshStyleValue(selectedEl, style);
                        console.log(`📝 Original ${style}:`, currentValue);
                        
                        return [
                            style,
                            {
                                value: currentValue,
                                type: StyleChangeType.Value,
                            },
                        ];
                    }),
                ),
            };
            
            console.log('📝 Final change object:', change);
            
            const target: StyleActionTarget = {
                frameId: selectedEl.frameId,
                domId: selectedEl.domId,
                oid: this.mode === StyleMode.Instance ? selectedEl.instanceId : selectedEl.oid,
                change: change,
            };
            return target;
        });

        const action = {
            type: 'update-style' as const,
            targets: targets,
        };
        
        console.log('✅ StyleManager.getUpdateStyleAction() - RESULT:', action);
        return action;
    }

    private getFreshStyleValue(selectedEl: DomElement, style: string): string {
        console.log(`🔍 getFreshStyleValue() - Getting ${style} for element ${selectedEl.domId}`);
        
        const definedValue = selectedEl.styles?.defined[style];
        const computedValue = selectedEl.styles?.computed[style];
        
        console.log(`🔍 ${style} - defined:`, definedValue);
        console.log(`🔍 ${style} - computed:`, computedValue);
        
        // For now, use cached styles but with proper fallbacks
        // TODO: Make this async to get truly fresh styles
        let currentValue = definedValue ?? computedValue;
        
        console.log(`🔍 ${style} - currentValue before fallback:`, currentValue);
        
        // If still no value, get a sensible default instead of empty string
        if (!currentValue || currentValue === '') {
            currentValue = this.getDefaultStyleValue(style);
            console.log(`🔍 ${style} - using default fallback:`, currentValue);
        }
        
        console.log(`🔍 ${style} - FINAL VALUE:`, currentValue);
        return currentValue;
    }

    private getDefaultStyleValue(style: string): string {
        // Provide sensible defaults instead of empty string
        const defaults: Record<string, string> = {
            opacity: '1',
            visibility: 'visible',
            display: 'block',
            color: 'rgb(0, 0, 0)',
            backgroundColor: 'rgba(0, 0, 0, 0)',
            fontSize: '16px',
            fontWeight: '400',
            lineHeight: 'normal',
            textAlign: 'start',
            width: 'auto',
            height: 'auto',
            margin: '0px',
            padding: '0px',
            border: '0px none rgb(0, 0, 0)',
            borderRadius: '0px',
            marginTop: '0px',
            marginRight: '0px', 
            marginBottom: '0px',
            marginLeft: '0px',
            paddingTop: '0px',
            paddingRight: '0px',
            paddingBottom: '0px',
            paddingLeft: '0px',
            top: 'auto',
            right: 'auto',
            bottom: 'auto',
            left: 'auto',
            position: 'static',
            zIndex: 'auto',
            transform: 'none',
            transformOrigin: '50% 50% 0px',
            boxShadow: 'none',
            textDecoration: 'none solid rgb(0, 0, 0)',
            textDecorationLine: 'none',
            textTransform: 'none',
            letterSpacing: 'normal',
            wordSpacing: 'normal',
            fontFamily: 'inherit',
            fontStyle: 'normal',
            fontVariant: 'normal',
            borderWidth: '0px',
            borderStyle: 'none',
            borderColor: 'rgb(0, 0, 0)',
            borderTopWidth: '0px',
            borderRightWidth: '0px',
            borderBottomWidth: '0px',
            borderLeftWidth: '0px',
        };
        
        return defaults[style] || 'initial';
    }

    updateStyleNoAction(styles: CSSProperties) {
        for (const [selector, selectedStyle] of this.domIdToStyle.entries()) {
            this.domIdToStyle.set(selector, {
                ...selectedStyle,
                styles: { ...selectedStyle.styles, ...styles },
            });
        }

        if (this.selectedStyle == null) {
            return;
        }
        this.selectedStyle = {
            ...this.selectedStyle,
            styles: { ...this.selectedStyle.styles, ...styles },
        };
    }

    private onSelectedElementsChanged(selectedElements: DomElement[]) {
        const newSelected = selectedElements
            .map((el) => el.domId)
            .toSorted()
            .join();
        if (newSelected !== this.prevSelected) {
            this.mode = StyleMode.Root;
        }
        this.prevSelected = newSelected;

        if (selectedElements.length === 0) {
            this.domIdToStyle = new Map();
            return;
        }

        const newMap = new Map<string, SelectedStyle>();
        let newSelectedStyle: SelectedStyle | null = null;
        for (const selectedEl of selectedElements) {
            const selectedStyle: SelectedStyle = {
                styles: selectedEl.styles ?? ({ defined: {}, computed: {} } as DomElementStyles),
                parentRect: selectedEl?.parent?.rect ?? ({} as DOMRect),
                rect: selectedEl?.rect ?? ({} as DOMRect),
            };
            newMap.set(selectedEl.domId, selectedStyle);
            newSelectedStyle ??= selectedStyle;
        }
        this.domIdToStyle = newMap;
        this.selectedStyle = newSelectedStyle;
    }

    clear() {
        // Clear state
        this.selectedStyle = null;
        this.domIdToStyle = new Map();
        this.prevSelected = '';
        this.mode = StyleMode.Root;
    }
}
