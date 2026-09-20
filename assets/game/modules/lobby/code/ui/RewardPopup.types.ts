export interface RewardPopupParams {
    readonly title: string;
    readonly amount: number;
}
export interface RewardPopupResult {
    readonly claimed: boolean;
    readonly amount: number;
}
